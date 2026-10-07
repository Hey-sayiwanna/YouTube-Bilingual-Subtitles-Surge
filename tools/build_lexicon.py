"""word -> most frequent (simplified) Brown tag. Used as POS-class features."""
import os, re, collections, json
counts = collections.defaultdict(collections.Counter)
for f in os.listdir("brown"):
    if not re.match(r"c[a-r]\d\d$", f): continue
    for tok in open(os.path.join("brown", f), encoding="latin-1").read().split():
        if "/" not in tok: continue
        w, t = tok.rsplit("/", 1)
        t = re.sub(r"-(tl|hl|nc)", "", t).replace("*", "")
        t = t.split("+")[0].split("-")[0]
        if not t or not re.match(r"[a-z$]", t): continue
        w = w.lower().replace("’", "'")
        w = re.sub(r"[^a-z0-9']", "", w).strip("'")
        if not w: continue
        if re.search(r"[0-9]", w): w = "<n>"
        counts[w][t] += 1
lex = {w: c.most_common(1)[0][0] for w, c in counts.items() if sum(c.values()) >= 2}
# frequent spoken contractions missing from Brown
for w, t in {"it's":"pps","that's":"dt","there's":"ex","i'm":"ppss","you're":"ppss","we're":"ppss","they're":"ppss","he's":"pps","she's":"pps","don't":"do","doesn't":"doz","didn't":"dod","can't":"md","won't":"md","isn't":"bez","aren't":"ber","wasn't":"bedz","i've":"ppss","we've":"ppss","you've":"ppss","they've":"ppss","i'll":"ppss","we'll":"ppss","you'll":"ppss","they'll":"ppss","let's":"vb","what's":"wdt","okay":"uh","ok":"uh","yeah":"uh","gonna":"vbg","wanna":"vb"}.items():
    lex[w] = t
json.dump(lex, open("lexicon_full.json", "w"))
print(len(lex), collections.Counter(lex.values()).most_common(40))
