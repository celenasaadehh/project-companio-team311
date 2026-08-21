import math

import numpy as np
import pandas as pd


TIME_TOLERANCE_SECONDS = 0.000001


def require_columns(data, required_columns, signal_name):
    """Verify that a DataFrame contains the required columns."""
    if not isinstance(data, pd.DataFrame):
        raise TypeError(
            f"{signal_name} must be a pandas DataFrame."
        )

    missing_columns = [
        column
        for column in required_columns
        if column not in data.columns
    ]

    if missing_columns:
        raise ValueError(
            f"{signal_name} is missing required columns: "
            f"{missing_columns}"
        )


def validate_regular_signal(
    data,
    start_timestamp,
    sampling_rate,
    signal_name,
):
    """Validate a regularly sampled sensor recording."""
    if data.empty:
        raise ValueError(
            f"{signal_name} contains no measurements."
        )

    try:
        start_timestamp = float(start_timestamp)
        sampling_rate = float(sampling_rate)
    except (TypeError, ValueError) as error:
        raise ValueError(
            f"{signal_name} has an invalid start time "
            f"or sampling rate."
        ) from error

    if not np.isfinite(start_timestamp):
        raise ValueError(
            f"{signal_name} has an invalid start timestamp: "
            f"{start_timestamp}"
        )

    if not np.isfinite(sampling_rate) or sampling_rate <= 0:
        raise ValueError(
            f"{signal_name} must have a positive sampling rate. "
            f"Received: {sampling_rate}"
        )


def add_regular_timestamps(
    data,
    start_timestamp,
    sampling_rate,
    signal_name,
):
    """
    Add an absolute Unix timestamp to each regularly sampled row.

    This works regardless of which sensor begins earlier or later.
    """
    validate_regular_signal(
        data,
        start_timestamp,
        sampling_rate,
        signal_name,
    )

    result = data.copy()

    sample_offsets = (
        np.arange(len(result), dtype=float)
        / float(sampling_rate)
    )

    result["timestamp"] = (
        float(start_timestamp)
        + sample_offsets
    )

    result["second"] = np.floor(
        result["timestamp"]
    ).astype(np.int64)

    return result


def calculate_recording_end(
    data,
    start_timestamp,
    sampling_rate,
    signal_name,
):
    """
    Calculate the exclusive ending time of a regular recording.

    If a signal has 100 samples at 10 Hz, it covers 10 seconds.
    """
    validate_regular_signal(
        data,
        start_timestamp,
        sampling_rate,
        signal_name,
    )

    duration_seconds = (
        len(data)
        / float(sampling_rate)
    )

    return (
        float(start_timestamp)
        + duration_seconds
    )


def add_ibi_timestamps(
    ibi,
    start_timestamp,
):
    """
    Convert IBI time offsets into absolute Unix timestamps.

    IBI is event-based rather than regularly sampled.
    """
    require_columns(
        ibi,
        ["time_offset_seconds", "ibi_seconds"],
        "IBI",
    )

    try:
        start_timestamp = float(start_timestamp)
    except (TypeError, ValueError) as error:
        raise ValueError(
            "IBI has an invalid start timestamp."
        ) from error

    if not np.isfinite(start_timestamp):
        raise ValueError(
            f"IBI has an invalid start timestamp: "
            f"{start_timestamp}"
        )

    result = ibi.copy()

    result["time_offset_seconds"] = pd.to_numeric(
        result["time_offset_seconds"],
        errors="coerce",
    )

    result["ibi_seconds"] = pd.to_numeric(
        result["ibi_seconds"],
        errors="coerce",
    )

    result = result.dropna(
        subset=[
            "time_offset_seconds",
            "ibi_seconds",
        ]
    ).copy()

    # Negative offsets would represent events before recording began.
    result = result[
        result["time_offset_seconds"] >= 0
    ].copy()

    # Physiologically impossible or corrupted IBI values are removed.
    # These are broad limits to avoid deleting unusual but possible data.
    result = result[
        (result["ibi_seconds"] > 0.25)
        & (result["ibi_seconds"] < 3.0)
    ].copy()

    result["timestamp"] = (
        start_timestamp
        + result["time_offset_seconds"]
    )

    result["second"] = np.floor(
        result["timestamp"]
    ).astype(np.int64)

    return result.reset_index(drop=True)


def summarize_signal_per_second(
    data,
    column_name,
    signal_name,
):
    """Average one continuous sensor signal for each second."""
    require_columns(
        data,
        ["second", column_name],
        signal_name,
    )

    result = data.copy()

    result[column_name] = pd.to_numeric(
        result[column_name],
        errors="coerce",
    )

    return (
        result.groupby(
            "second",
            as_index=False,
        )[column_name]
        .mean()
    )


def summarize_acc_per_second(acc):
    """
    Reduce accelerometer data to one row per second.

    Output includes:
    - Mean X, Y and Z acceleration
    - Mean acceleration magnitude
    - Standard deviation of magnitude

    Magnitude variation is useful as an estimate of movement intensity.
    """
    require_columns(
        acc,
        [
            "second",
            "acc_x",
            "acc_y",
            "acc_z",
        ],
        "ACC",
    )

    result = acc.copy()

    for column in [
        "acc_x",
        "acc_y",
        "acc_z",
    ]:
        result[column] = pd.to_numeric(
            result[column],
            errors="coerce",
        )

    result["acc_magnitude"] = np.sqrt(
        result["acc_x"] ** 2
        + result["acc_y"] ** 2
        + result["acc_z"] ** 2
    )

    summary = (
        result.groupby("second")
        .agg(
            acc_x_mean=("acc_x", "mean"),
            acc_y_mean=("acc_y", "mean"),
            acc_z_mean=("acc_z", "mean"),
            acc_magnitude_mean=(
                "acc_magnitude",
                "mean",
            ),
            acc_magnitude_std=(
                "acc_magnitude",
                "std",
            ),
        )
        .reset_index()
    )

    return summary


def summarize_ibi_per_second(ibi):
    """
    Summarize IBI events occurring during each second.

    IBI is not interpolated because it is an irregular event signal.
    HRV will later be calculated over longer windows.
    """
    require_columns(
        ibi,
        [
            "second",
            "ibi_seconds",
        ],
        "IBI",
    )

    return (
        ibi.groupby("second")
        .agg(
            ibi_mean_seconds=(
                "ibi_seconds",
                "mean",
            ),
            ibi_count=(
                "ibi_seconds",
                "count",
            ),
        )
        .reset_index()
    )


def find_common_recording_interval(
    regular_recordings,
):
    """
    Find the time range shared by every regular sensor.

    The common recording begins when the last sensor starts and ends
    when the first sensor stops.

    Therefore, this works whether HR, EDA, temperature, ACC, or another
    included regular signal starts late or ends early.
    """
    if not regular_recordings:
        raise ValueError(
            "At least one regular recording is required."
        )

    start_times = []
    end_times = []

    for recording in regular_recordings:
        signal_name = recording["name"]
        data = recording["data"]
        start_timestamp = recording["start_timestamp"]
        sampling_rate = recording["sampling_rate"]

        validate_regular_signal(
            data,
            start_timestamp,
            sampling_rate,
            signal_name,
        )

        start_times.append(
            float(start_timestamp)
        )

        end_times.append(
            calculate_recording_end(
                data,
                start_timestamp,
                sampling_rate,
                signal_name,
            )
        )

    # Whichever sensor starts latest controls the shared start.
    common_start = max(start_times)

    # Whichever sensor ends earliest controls the shared end.
    common_end = min(end_times)

    # Only retain complete one-second periods shared by every sensor.
    first_second = int(
        math.ceil(
            common_start
            - TIME_TOLERANCE_SECONDS
        )
    )

    final_second_exclusive = int(
        math.floor(
            common_end
            + TIME_TOLERANCE_SECONDS
        )
    )

    if final_second_exclusive <= first_second:
        raise ValueError(
            "The regular sensor recordings do not have a usable "
            "overlapping time period."
        )

    return (
        first_second,
        final_second_exclusive,
        common_start,
        common_end,
    )


def interpolate_only_short_internal_gaps(
    data,
    columns,
    maximum_gap_seconds=2,
):
    """
    Interpolate only complete short gaps surrounded by real values.

    This function does not:
    - fill values before a sensor begins;
    - fill values after a sensor ends;
    - partially fill long missing sections.
    """
    if maximum_gap_seconds < 0:
        raise ValueError(
            "maximum_gap_seconds cannot be negative."
        )

    result = data.copy()

    for column in columns:
        if column not in result.columns:
            continue

        values = pd.to_numeric(
            result[column],
            errors="coerce",
        )

        interpolated_values = values.interpolate(
            method="linear",
            limit_area="inside",
        )

        missing = values.isna().to_numpy()
        row_count = len(values)
        position = 0

        while position < row_count:
            if not missing[position]:
                position += 1
                continue

            gap_start = position

            while (
                position < row_count
                and missing[position]
            ):
                position += 1

            gap_end = position
            gap_length = gap_end - gap_start

            has_value_before = (
                gap_start > 0
                and pd.notna(
                    values.iloc[gap_start - 1]
                )
            )

            has_value_after = (
                gap_end < row_count
                and pd.notna(
                    values.iloc[gap_end]
                )
            )

            is_short_internal_gap = (
                gap_length <= maximum_gap_seconds
                and has_value_before
                and has_value_after
            )

            if is_short_internal_gap:
                values.iloc[gap_start:gap_end] = (
                    interpolated_values.iloc[
                        gap_start:gap_end
                    ]
                )

        result[column] = values

    return result


def create_synchronized_table(
    hr,
    hr_start,
    hr_rate,
    eda,
    eda_start,
    eda_rate,
    temp,
    temp_start,
    temp_rate,
    acc,
    acc_start,
    acc_rate,
    ibi,
    ibi_start,
):
    """
    Create one synchronized row per second.

    The synchronization is not based on HR specifically. Every regular
    sensor is treated equally when determining the shared time range.
    """
    require_columns(
        hr,
        ["heart_rate"],
        "HR",
    )

    require_columns(
        eda,
        ["eda"],
        "EDA",
    )

    require_columns(
        temp,
        ["temperature"],
        "TEMP",
    )

    require_columns(
        acc,
        [
            "acc_x",
            "acc_y",
            "acc_z",
        ],
        "ACC",
    )

    # Add each sensor's real timestamps independently.
    hr_timed = add_regular_timestamps(
        hr,
        hr_start,
        hr_rate,
        "HR",
    )

    eda_timed = add_regular_timestamps(
        eda,
        eda_start,
        eda_rate,
        "EDA",
    )

    temp_timed = add_regular_timestamps(
        temp,
        temp_start,
        temp_rate,
        "TEMP",
    )

    acc_timed = add_regular_timestamps(
        acc,
        acc_start,
        acc_rate,
        "ACC",
    )

    ibi_timed = add_ibi_timestamps(
        ibi,
        ibi_start,
    )

    # Reduce regular sensors to one measurement row per second.
    hr_1s = summarize_signal_per_second(
        hr_timed,
        "heart_rate",
        "HR",
    )

    eda_1s = summarize_signal_per_second(
        eda_timed,
        "eda",
        "EDA",
    )

    temp_1s = summarize_signal_per_second(
        temp_timed,
        "temperature",
        "TEMP",
    )

    acc_1s = summarize_acc_per_second(
        acc_timed,
    )

    ibi_1s = summarize_ibi_per_second(
        ibi_timed,
    )

    # All continuously sampled signals are included equally here.
    regular_recordings = [
        {
            "name": "HR",
            "data": hr,
            "start_timestamp": hr_start,
            "sampling_rate": hr_rate,
        },
        {
            "name": "EDA",
            "data": eda,
            "start_timestamp": eda_start,
            "sampling_rate": eda_rate,
        },
        {
            "name": "TEMP",
            "data": temp,
            "start_timestamp": temp_start,
            "sampling_rate": temp_rate,
        },
        {
            "name": "ACC",
            "data": acc,
            "start_timestamp": acc_start,
            "sampling_rate": acc_rate,
        },
    ]

    (
        first_second,
        final_second_exclusive,
        common_start,
        common_end,
    ) = find_common_recording_interval(
        regular_recordings
    )

    # Build a complete one-row-per-second shared timeline.
    synchronized = pd.DataFrame(
        {
            "second": np.arange(
                first_second,
                final_second_exclusive,
                dtype=np.int64,
            )
        }
    )

    # Merge values using the actual Unix second.
    synchronized = synchronized.merge(
        hr_1s,
        on="second",
        how="left",
    )

    synchronized = synchronized.merge(
        eda_1s,
        on="second",
        how="left",
    )

    synchronized = synchronized.merge(
        temp_1s,
        on="second",
        how="left",
    )

    synchronized = synchronized.merge(
        acc_1s,
        on="second",
        how="left",
    )

    # IBI is merged onto the shared timeline but does not determine
    # its starting or ending boundaries.
    synchronized = synchronized.merge(
        ibi_1s,
        on="second",
        how="left",
    )

    regular_columns = [
        "heart_rate",
        "eda",
        "temperature",
        "acc_x_mean",
        "acc_y_mean",
        "acc_z_mean",
        "acc_magnitude_mean",
        "acc_magnitude_std",
    ]

    synchronized = (
        interpolate_only_short_internal_gaps(
            synchronized,
            regular_columns,
            maximum_gap_seconds=2,
        )
    )

    # No IBI event in a given second means zero events.
    synchronized["ibi_count"] = (
        synchronized["ibi_count"]
        .fillna(0)
        .astype(int)
    )

    # ibi_mean_seconds intentionally remains NaN when no event occurred.

    synchronized["datetime_utc"] = pd.to_datetime(
        synchronized["second"],
        unit="s",
        utc=True,
    )

    synchronized["relative_second"] = (
        synchronized["second"]
        - first_second
    )

    required_regular_columns = [
        "heart_rate",
        "eda",
        "temperature",
        "acc_magnitude_mean",
        "acc_magnitude_std",
    ]

    synchronized["regular_signals_complete"] = (
        synchronized[
            required_regular_columns
        ]
        .notna()
        .all(axis=1)
    )

    column_order = [
        "second",
        "relative_second",
        "datetime_utc",
        "heart_rate",
        "eda",
        "temperature",
        "acc_x_mean",
        "acc_y_mean",
        "acc_z_mean",
        "acc_magnitude_mean",
        "acc_magnitude_std",
        "ibi_mean_seconds",
        "ibi_count",
        "regular_signals_complete",
    ]

    synchronized = synchronized[
        column_order
    ].reset_index(drop=True)

    # Save useful alignment information with the DataFrame.
    synchronized.attrs["common_start_timestamp"] = (
        common_start
    )
    synchronized.attrs["common_end_timestamp"] = (
        common_end
    )
    synchronized.attrs["first_complete_second"] = (
        first_second
    )
    synchronized.attrs[
        "final_complete_second_exclusive"
    ] = final_second_exclusive

    return synchronized