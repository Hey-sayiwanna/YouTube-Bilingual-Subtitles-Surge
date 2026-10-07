"""Character-context boundary model for punctuation-free Japanese / Korean ASR.

usage: python3 train_cjk.py ja|ko [max_samples] [kept_features]
input : {lang}_sentences.txt  (source \t sentence)   -> output: model_{lang}.json
Labels: 0 none, 1 comma, 2 sentence end.  Mirrors scoreCjkBoundaries() in asrCjkSegmenter.mjs.
"""
import sys, json, unicodedata, collections, re
import numpy as np, scipy.sparse as sp
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import classification_report

PERIOD = set("。.!?！？…")
COMMA = set("、,，")

def norm_char(c):
    if c.isdigit(): return "0"
    if "a" <= c.lower() <= "z": return "a"
    return c

def char_type(c):
    o = ord(c)
    if c == " ": return "S"
    if 0x3040 <= o <= 0x309f: return "H"
    if 0x30a0 <= o <= 0x30ff: return "K"
    if 0x4e00 <= o <= 0x9fff or 0x3400 <= o <= 0x4dbf: return "C"
    if 0xac00 <= o <= 0xd7a3: return "G"
    if c == "a": return "A"
    if c == "0": return "D"
    return "O"

def keep(c):
    cat = unicodedata.category(c)
    return cat[0] in "LN"

def stream(lang, sentences):
    """returns chars (list) and labels per gap-after-char (only candidate gaps get label != -1)"""
    chars, labels = [], []
    for s in sentences:
        s = unicodedata.normalize("NFKC", s)
        start = len(chars)
        if lang == "ko":
            for tok in s.split():
                kept = [norm_char(c) for c in tok if keep(c)]
                lab = 2 if any(c in PERIOD for c in tok[-2:]) else 1 if tok[-1:] in COMMA else 0
                if not kept:
                    if len(chars) > start: labels[-1] = max(labels[-1], lab)
                    continue
                if len(chars) > start:
                    chars.append(" "); labels.append(-1)
                for c in kept:
                    chars.append(c); labels.append(-1)
                labels[-1] = lab
        else:
            for c in s:
                if c in PERIOD:
                    if len(chars) > start: labels[-1] = 2
                elif c in COMMA:
                    if len(chars) > start and labels[-1] < 2: labels[-1] = 1
                elif keep(c):
                    chars.append(norm_char(c)); labels.append(0)
        if len(chars) > start:
            labels[-1] = 2
            if lang == "ko":
                chars.append(" "); labels.append(-1)
    return chars, labels

def candidates(lang, chars, labels):
    """indexes i such that the gap after chars[i] is a candidate boundary"""
    if lang == "ko":
        return [i for i in range(len(chars) - 2) if chars[i] != " " and chars[i + 1] == " "]
    return list(range(len(chars) - 1))

def feats(lang, chars, i):
    """boundary after chars[i]. For ko chars[i+1] is the space, right context starts at i+2."""
    n = len(chars)
    r0 = i + 2 if lang == "ko" else i + 1
    L = "".join(chars[max(0, i - 3): i + 1]).rjust(4, "_")
    R = "".join(chars[r0: r0 + 3]).ljust(3, "_")
    tL = "".join(char_type(c) if c != "_" else "_" for c in L[-3:])
    tR = "".join(char_type(c) if c != "_" else "_" for c in R[:2])
    f = ["a:" + L[-1], "b:" + L[-2:], "c:" + L[-3:], "d:" + L,
         "e:" + R[0], "f:" + R[:2], "g:" + R,
         "h:" + L[-1] + "|" + R[0], "i:" + L[-2:] + "|" + R[0], "j:" + L[-1] + "|" + R[:2],
         "k:" + L[-3:] + "|" + R[0], "y:" + L[-2:] + "|" + R[:2], "t:" + tL + "|" + tR]
    if lang == "ko":
        j = i
        while j >= 0 and chars[j] != " ": j -= 1
        lw = "".join(chars[j + 1: i + 1])
        k = r0
        while k < n and chars[k] != " ": k += 1
        rw = "".join(chars[r0:k])
        if len(lw) <= 8: f.append("w:" + lw)
        if len(rw) <= 8: f.append("x:" + rw)
    return f

if __name__ == "__main__":
    lang = sys.argv[1]
    cap = int(sys.argv[2]) if len(sys.argv) > 2 else 1500000
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 30000
    rows = [l.split("\t", 1)[1] for l in open(f"{lang}_sentences.txt", encoding="utf-8").read().split("\n") if "\t" in l]
    test_rows, train_rows = rows[:4000], rows[4000:]
    chars, labels = stream(lang, train_rows)
    cand = candidates(lang, chars, labels)[:cap]
    print(lang, "train samples", len(cand), flush=True)
    counter = collections.Counter()
    for i in cand: counter.update(feats(lang, chars, i))
    index = {f: j for j, f in enumerate(f for f, c in counter.items() if c >= 3)}
    names = [None] * len(index)
    for f, j in index.items(): names[j] = f
    del counter
    print("features", len(index), flush=True)
    def matrix(chars, labels, cand):
        r, cidx = [], []
        for row, i in enumerate(cand):
            for f in feats(lang, chars, i):
                j = index.get(f)
                if j is not None: r.append(row); cidx.append(j)
        X = sp.csr_matrix((np.ones(len(r), dtype=np.float32), (np.array(r, dtype=np.int32), np.array(cidx, dtype=np.int32))), shape=(len(cand), len(index)))
        return X, np.array([labels[i] for i in cand])
    X, y = matrix(chars, labels, cand)
    clf = SGDClassifier(loss="log_loss", alpha=2e-6, max_iter=10, tol=None, random_state=0)
    clf.fit(X, y)
    tc, tl = stream(lang, test_rows)
    Xe, ye = matrix(tc, tl, candidates(lang, tc, tl))
    print(classification_report(ye, clf.predict(Xe), digits=3), flush=True)
    freq = np.asarray((X != 0).sum(axis=0)).ravel()
    imp = np.abs(clf.coef_).max(axis=0) * np.log1p(freq)
    order = np.argsort(-imp)[:limit]
    W = {}
    for j in order:
        q = [int(round(c * 64)) for c in clf.coef_[:, j]]
        if any(q): W[names[j]] = q
    bias = [round(float(b), 4) for b in clf.intercept_]
    Wq = np.zeros((3, len(index)), dtype=np.float32)
    for f, q in W.items(): Wq[:, index[f]] = np.array(q) / 64
    print("pruned", len(W))
    print(classification_report(ye, np.asarray(Xe @ Wq.T + np.array(bias)).argmax(axis=1), digits=3), flush=True)
    json.dump({"lang": lang, "scale": 64, "bias": bias, "w": W}, open(f"model_{lang}.json", "w"), ensure_ascii=False, separators=(",", ":"))
    open(f"test_{lang}.txt", "w").write("\n".join(test_rows))
