#!/usr/bin/env python3

# delta_names.py - i nomi dei file di .delta/ sul ramo 'data' (push incrementale di publish.sh).
# git 2.20 cerca le basi dei delta nel commit genitore e ne prende una sola per "name hash" (~ultimi 16
# caratteri del percorso): .delta/ = gli stessi file con nomi corti a name hash unico (stessi blob: zero spazio
# in piu'), senza i quali circa meta' dei byte cambiati partirebbe intera.
# stdin = 'git ls-files -s -z', argv[1] = mappa percorso->nome (chi c'era tiene il suo nome, cioe' ritrova la
# base del giro prima), stdout = righe per 'git mktree'.
#
# Uso (da publish.sh):   git ls-files -s -z | python3 delta_names.py MAPPA | git mktree

import hashlib, os, sys
def nh(p):                                    # = pack_name_hash() di git
    h = 0
    for c in p.encode('utf-8', 'surrogateescape'):
        if c not in b' \t\n\v\f\r':
            h = ((h >> 2) + (c << 24)) & 0xffffffff
    return h
def cand(p, k):                               # k-esimo candidato: 6 caratteri base 36
    v = int(hashlib.sha1(('%s#%d' % (p, k)).encode('utf-8', 'surrogateescape')).hexdigest(), 16)
    return ''.join('0123456789abcdefghijklmnopqrstuvwxyz'[(v // 36 ** i) % 36] for i in range(6))
old, ent, new, names = {}, [], {}, set()
try:
    for l in open(sys.argv[1], encoding='utf-8', errors='surrogateescape'):
        p, _, n = l.rstrip('\n').partition('\t')
        old[p] = n
except OSError:
    pass
for rec in sys.stdin.buffer.read().split(b'\0'):
    if rec:
        meta, p = rec.split(b'\t', 1)
        m, s = meta.split(b' ')[:2]
        ent.append((m.decode(), s.decode(), p.decode('utf-8', 'surrogateescape')))
used = {0, nh('.delta')}                      # hash gia' visti prima dei blob: radice, .delta, cartelle
for _, _, p in ent:
    d = os.path.dirname(p)
    while d:
        used.add(nh(d))
        d = os.path.dirname(d)
def take(p, n):
    h = nh('.delta/' + n)
    if n and n not in names and h not in used:
        new[p] = n
        names.add(n)
        used.add(h)
for _, _, p in ent:
    if p in old:
        take(p, old[p])
for _, _, p in ent:
    k = 0
    while p not in new:
        take(p, cand(p, k))
        k += 1
for m, s, p in ent:
    sys.stdout.write('%s blob %s\t%s\n' % (m, s, new[p]))
with open(sys.argv[1] + '.tmp', 'w', encoding='utf-8', errors='surrogateescape') as f:
    f.writelines('%s\t%s\n' % (p, new[p]) for p in sorted(new))
os.replace(sys.argv[1] + '.tmp', sys.argv[1])
