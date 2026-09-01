# =============================================================================
# detector_tfidf/train.py  -  APPROACH 1 of 3: TF-IDF + Logistic Regression
# =============================================================================
# The classic, fast, reliable approach. Turns text into TF-IDF numbers (important
# words get bigger numbers) and learns a simple linear classifier.
# Data: Dreaddit, filtered to PTSD + anxiety. Reports on the official test split.
#   Result: ~74% accuracy.
# Run (from the ml folder):  python3 detector_tfidf/train.py
# =============================================================================
import csv
from pathlib import Path
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report, accuracy_score, f1_score

DATA = Path(__file__).parent.parent / "data"
FOCUS = {"ptsd", "anxiety"}   # PTSD + anxiety only

def load(name):
    texts, labels = [], []
    for row in csv.DictReader(open(DATA / name, encoding="latin-1")):
        if row.get("subreddit") in FOCUS:
            texts.append(row["text"])
            labels.append("stress" if row["label"].strip() == "1" else "not_stress")
    return texts, labels

def main():
    Xtr, ytr = load("dreaddit_train.csv")
    Xte, yte = load("dreaddit_test.csv")
    print("train:", len(Xtr), "| test:", len(Xte))
    model = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, stop_words="english")),
        ("clf", LogisticRegression(max_iter=2000, class_weight="balanced", C=3.0)),
    ])
    model.fit(Xtr, ytr)
    pred = model.predict(Xte)
    print(f"\n[TF-IDF] accuracy: {accuracy_score(yte,pred):.3f} | macro F1: {f1_score(yte,pred,average='macro'):.3f}")
    print(classification_report(yte, pred))
    joblib.dump(model, Path(__file__).parent / "model.joblib")
    print("saved model.joblib")

if __name__ == "__main__":
    main()
