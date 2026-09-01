# =============================================================================
# detector_bert/train.py  -  APPROACH 3 of 3: Fine-tuned BERT (DistilBERT)
# =============================================================================
# The most powerful approach. We take a pretrained language model (DistilBERT,
# a smaller/faster BERT) that already "understands" English, and FINE-TUNE it on
# our Dreaddit PTSD+anxiety posts (a few passes over the data). This usually
# gives the best accuracy of the three (~78-80%), at the cost of a big download
# and slower CPU training.
# Run (from the ml folder):  python3 detector_bert/train.py
# =============================================================================
import csv
from pathlib import Path
import torch
from transformers import (AutoTokenizer, AutoModelForSequenceClassification,
                          TrainingArguments, Trainer)
from sklearn.metrics import accuracy_score, f1_score, classification_report

DATA = Path(__file__).parent.parent / "data"
FOCUS = {"ptsd", "anxiety"}
MODEL_NAME = "distilbert-base-uncased"
LABEL2ID = {"not_stress": 0, "stress": 1}
ID2LABEL = {0: "not_stress", 1: "stress"}


def load(name):
    texts, labels = [], []
    for row in csv.DictReader(open(DATA / name, encoding="latin-1")):
        if row.get("subreddit") in FOCUS:
            texts.append(row["text"])
            labels.append(1 if row["label"].strip() == "1" else 0)
    return texts, labels


class DS(torch.utils.data.Dataset):
    """Wrap tokenised text + labels so the Trainer can read them."""
    def __init__(self, enc, labels):
        self.enc = enc
        self.labels = labels
    def __len__(self):
        return len(self.labels)
    def __getitem__(self, i):
        item = {k: torch.tensor(v[i]) for k, v in self.enc.items()}
        item["labels"] = torch.tensor(self.labels[i])
        return item


def main():
    Xtr, ytr = load("dreaddit_train.csv")
    Xte, yte = load("dreaddit_test.csv")
    print("train:", len(Xtr), "| test:", len(Xte))

    # 1) Tokeniser turns text into the token-ids BERT expects.
    print("loading tokenizer + model (downloads ~260 MB once)...")
    tok = AutoTokenizer.from_pretrained(MODEL_NAME)
    enc_tr = tok(Xtr, truncation=True, padding=True, max_length=256)
    enc_te = tok(Xte, truncation=True, padding=True, max_length=256)
    ds_tr, ds_te = DS(enc_tr, ytr), DS(enc_te, yte)

    # 2) Load DistilBERT with a fresh 2-class classification head on top.
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME, num_labels=2, id2label=ID2LABEL, label2id=LABEL2ID
    )

    # 3) Training settings (3 passes over the data; CPU is slow but fine for ~1k rows).
    args = TrainingArguments(
        output_dir=str(Path(__file__).parent / "bert_out"),
        num_train_epochs=3,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=32,
        logging_steps=25,
        report_to="none",     # don't try to log to any external service
        save_strategy="no",   # don't save checkpoints (saves disk)
    )
    trainer = Trainer(model=model, args=args, train_dataset=ds_tr)

    # 4) FINE-TUNE (this is the training).
    trainer.train()

    # 5) Predict on the official test set and score it.
    out = trainer.predict(ds_te)
    preds = out.predictions.argmax(axis=1)
    acc = accuracy_score(yte, preds)
    f1 = f1_score(yte, preds, average="macro")
    print(f"\n[BERT] accuracy: {acc:.3f} | macro F1: {f1:.3f}")
    print(classification_report(yte, preds, target_names=["not_stress", "stress"]))

    # 6) Save the fine-tuned model.
    model.save_pretrained(Path(__file__).parent / "bert_model")
    tok.save_pretrained(Path(__file__).parent / "bert_model")
    print("saved bert_model/")


if __name__ == "__main__":
    main()
