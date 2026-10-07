"""Train the tiny ASR boundary model (O / COMMA / PERIOD).

Data   : IWSLT2012 TED transcripts (spoken English, punctuation labels)
         https://github.com/xashru/punctuation-restoration/tree/master/data/en
Lexicon: most frequent Brown-corpus tag per word (build_lexicon.py)
Output : model.json -> build_model.py -> src/function/asrBoundaryModel.mjs

usage: python3 train.py [kept_features=40000] [vocab_size=12000]
The feature extraction MUST stay identical to scoreBoundaries() in asrSegmenter.mjs.
"""
import json, re, sys, collections
import numpy as np
import scipy.sparse as sp
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import classification_report

LABELS = {"O": 0, "COMMA": 1, "PERIOD": 2, "QUESTION": 2}
LEX = json.load(open("lexicon_full.json"))


def norm(tok):
    t = tok.lower().replace("’", "'")
    t = re.sub(r"[^a-z0-9']", "", t).strip("'")
    if not t:
        return ""
    if re.search(r"[0-9]", t):
        return "<n>"
    return t


def guess_tag(w):
    if w == "<n>": return "cd"
    if w.endswith("'s"): return "np$"
    if w.endswith("ing"): return "vbg"
    if w.endswith("ed"): return "vbn"
    if w.endswith("ly"): return "rb"
    if w.endswith("s") and not w.endswith("ss"): return "nns"
    return "np"


def load(path):
    words, labels = [], []
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) != 2:
            continue
        w, l = parts
        y = LABELS.get(l, 0)
        lw = w.lower()
        if words and (lw.startswith("'") or lw == "n't"):
            words[-1] = words[-1] + lw
            labels[-1] = y
            continue
        n = norm(w)
        if not n:
            if labels:
                labels[-1] = max(labels[-1], y)
            continue
        words.append(n)
        labels.append(y)
    return words, labels


def feats(W, T, i):
    """Feature strings for the boundary AFTER W[i]. Mirror of scoreBoundaries()."""
    n = len(W)
    g = lambda k: W[k] if 0 <= k < n else "_"
    h = lambda k: T[k] if 0 <= k < n else "_"
    a2, a1, a0, b0, b1 = g(i - 2), g(i - 1), g(i), g(i + 1), g(i + 2)
    x2, x1, x0, y0, y1, y2, y3 = h(i - 2), h(i - 1), h(i), h(i + 1), h(i + 2), h(i + 3), h(i + 4)
    return (
        "p:" + a0, "q:" + a1, "n:" + b0, "m:" + b1, "r:" + a2,
        "A:" + a1 + "|" + a0, "B:" + a0 + "|" + b0, "C:" + b0 + "|" + b1,
        "D:" + a0 + "|" + b0 + "|" + b1, "E:" + a1 + "|" + a0 + "|" + b0,
        "t:" + x0, "u:" + y0,
        "TA:" + x1 + "|" + x0, "TB:" + x0 + "|" + y0, "TC:" + y0 + "|" + y1,
        "TD:" + y0 + "|" + y1 + "|" + y2, "TE:" + x0 + "|" + y0 + "|" + y1,
        "TF:" + y0 + "|" + y1 + "|" + y2 + "|" + y3,
        "TG:" + x1 + "|" + x0 + "|" + y0 + "|" + y1,
        "TH:" + x2 + "|" + x1 + "|" + x0,
        "MW:" + a0 + "|" + y0 + "|" + y1, "MX:" + x0 + "|" + b0,
    )


def prepare(words, vocab):
    tags = [LEX[w] if (w in vocab and w in LEX) else guess_tag(w) for w in words]
    words = [w if w in vocab else "<unk>" for w in words]
    return words, tags


if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 40000
    vocab_size = int(sys.argv[2]) if len(sys.argv) > 2 else 12000
    use_pos = (sys.argv[3] if len(sys.argv) > 3 else "pos") == "pos"
    out = sys.argv[4] if len(sys.argv) > 4 else "model.json"
    with_dev = (sys.argv[5] if len(sys.argv) > 5 else "nodev") == "dev"
    tw, tl = load("ted_train2012")
    if with_dev:
        dw, dl = load("ted_dev2012")
        tw += dw; tl += dl
    ew, el = load("ted_test2011")
    wc = collections.Counter(tw)
    vocab = {w for w, _ in wc.most_common(vocab_size)} | {"<n>"}
    tw, tt = prepare(tw, vocab)
    ew, et = prepare(ew, vocab)
    print("train words", len(tw))

    counter = collections.Counter()
    keepf = (lambda f: True) if use_pos else (lambda f: f.split(":")[0] in {"p","q","n","m","r","A","B","C","D","E"})
    for i in range(len(tw) - 1):
        counter.update(f for f in feats(tw, tt, i) if keepf(f))
    index = {}
    for f, c in counter.items():
        if c >= 3:
            index[f] = len(index)
    del counter
    names = [None] * len(index)
    for f, j in index.items():
        names[j] = f
    print("features", len(index))

    def matrix(W, T, L):
        rows, cols = [], []
        for i in range(len(W) - 1):
            for f in feats(W, T, i):
                j = index.get(f)
                if j is not None:
                    rows.append(i); cols.append(j)
        X = sp.csr_matrix((np.ones(len(rows), dtype=np.float32), (np.array(rows, dtype=np.int32), np.array(cols, dtype=np.int32))), shape=(len(W) - 1, len(index)))
        return X, np.array(L[: len(W) - 1])

    X, y = matrix(tw, tt, tl)
    clf = SGDClassifier(loss="log_loss", alpha=2e-6, max_iter=10, tol=None, random_state=0)
    clf.fit(X, y)
    Xe, ye = matrix(ew, et, el)
    print(classification_report(ye, clf.predict(Xe), target_names=["O", "COMMA", "PERIOD"], digits=3))

    coef = clf.coef_
    # importance = |weight| x how often the feature fires (log-scaled)
    freq = np.asarray((X != 0).sum(axis=0)).ravel()
    importance = np.abs(coef).max(axis=0) * np.log1p(freq)
    order = np.argsort(-importance)[:limit]
    scale = 64.0
    Wt = {}
    for j in order:
        q = [int(round(c * scale)) for c in coef[:, j]]
        if any(q):
            Wt[names[j]] = q
    bias = [round(float(b), 4) for b in clf.intercept_]
    lex = {w: LEX[w] for w in sorted(vocab) if w in LEX}
    json.dump({"scale": scale, "bias": bias, "w": Wt, "vocab": sorted(vocab - {"<n>"}), "lex": lex}, open(out, "w"), separators=(",", ":"))

    # evaluate pruned + quantised model exactly as the JS runtime does
    Wq = np.zeros((3, len(index)), dtype=np.float32)
    for f, q in Wt.items():
        Wq[:, index[f]] = np.array(q) / scale
    scores = Xe @ Wq.T + np.array(bias)
    print("pruned model, features kept:", len(Wt))
    print(classification_report(ye, np.asarray(scores).argmax(axis=1), target_names=["O", "COMMA", "PERIOD"], digits=3))
