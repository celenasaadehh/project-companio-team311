# =============================================================================
# detector_embeddings/train.py  -  APPROACH 2 of 3: Sentence embeddings + classifier
# =============================================================================
# Instead of TF-IDF word-counts, we turn each post into a MEANING vector using a
# small pretrained neural model ("all-MiniLM-L6-v2" from sentence-transformers),
# then train a simple Logistic Regression on those vectors. Embeddings capture
# meaning (not just words), so this usually beats TF-IDF by a few points.
# Data: Dreaddit, PTSD + anxiety. Reports on the official test split.
# Run (from the ml folder):  python3 detector_embeddings/train.py
# =============================================================================
import csv
from pathlib import Path
import joblib
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, accuracy_score, f1_score

DATA = Path(__file__).parent.parent / "data"
FOCUS = {"ptsd", "anxiety"}

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

    # Load the pretrained embedding model (downloads once, ~90 MB).
    print("loading embedding model (all-MiniLM-L6-v2)...")
    embedder = SentenceTransformer("all-MiniLM-L6-v2")

    # Turn every post into a meaning-vector.
    print("embedding texts...")
    Etr = embedder.encode(Xtr, show_progress_bar=False, batch_size=32)
    Ete = embedder.encode(Xte, show_progress_bar=False, batch_size=32)

    # Train a simple classifier on the vectors.
    clf = LogisticRegression(max_iter=2000, class_weight="balanced", C=3.0)
    clf.fit(Etr, ytr)
    pred = clf.predict(Ete)
    print(f"\n[EMBEDDINGS] accuracy: {accuracy_score(yte,pred):.3f} | macro F1: {f1_score(yte,pred,average='macro'):.3f}")
    print(classification_report(yte, pred))

    joblib.dump(clf, Path(__file__).parent / "classifier.joblib")
    print("saved classifier.joblib (uses all-MiniLM-L6-v2 embeddings at inference)")

if __name__ == "__main__":
    main()
