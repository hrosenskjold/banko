import numpy as np, random, json, base64, time, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from sklearn.neural_network import MLPClassifier
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from digitnorm import normalize
SP = sys.argv[1]; OUT = sys.argv[2]
rng = np.random.RandomState(0); random.seed(0)

def idx(path):
    d = open(path, 'rb').read()
    if d[2] == 8 and d[3] == 3:
        n, h, w = np.frombuffer(d[4:16], '>i4'); return np.frombuffer(d[16:], np.uint8).reshape(n, h, w)
    n = np.frombuffer(d[4:8], '>i4')[0]; return np.frombuffer(d[8:], np.uint8)
Xtr, ytr = idx(SP + '/mnist/train-images-idx3-ubyte'), idx(SP + '/mnist/train-labels-idx1-ubyte')
Xte, yte = idx(SP + '/mnist/t10k-images-idx3-ubyte'), idx(SP + '/mnist/t10k-labels-idx1-ubyte')

def mnist_mask(img, aug):
    im = Image.fromarray(img).resize((84, 84), Image.BILINEAR)
    if aug:
        im = im.rotate(rng.uniform(-12, 12), resample=Image.BILINEAR)
        if rng.rand() < 0.3: im = im.transform(im.size, Image.AFFINE, (1, rng.uniform(-0.25, 0.25), 0, 0, 1, 0), Image.BILINEAR)
    m = np.array(im) > 110
    if aug:
        t = rng.rand()
        if t < 0.35: m = np.array(Image.fromarray(m.astype(np.uint8)*255).filter(ImageFilter.MinFilter(3))) > 0   # tyndere
        elif t < 0.55: m = np.array(Image.fromarray(m.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(3))) > 0  # tykkere
    return m

FONTS = ['Candara','Candarab','Gabriola','Inkfree','arial','arialbd','ariblk','bahnschrift','calibri','calibrib','cambriab','comic','comicbd',
         'consola','consolab','constan','corbel','corbelb','cour','courbd','ebrima','framd','gadugi','georgia','georgiab','impact','javatext',
         'lucon','micross','pala','palab','segoepr','segoesc','segoescb','segoeui','segoeuib','segoeuil','seguisb','sylfaen','tahoma',
         'tahomabd','times','timesbd','trebuc','trebucbd','verdana','verdanab']
HELD = ['mvboli', 'segoeprb']

def font_mask(fname, d, aug=True):
    f = ImageFont.truetype(f'C:/Windows/Fonts/{fname}.ttf', 90)
    im = Image.new('L', (160, 160), 0); dr = ImageDraw.Draw(im)
    sw = rng.randint(0, 3) if aug else 0
    dr.text((40, 20), str(d), fill=255, font=f, stroke_width=sw, stroke_fill=255)
    if aug:
        im = im.rotate(rng.uniform(-8, 8), resample=Image.BILINEAR)
        if rng.rand() < 0.3: im = im.transform(im.size, Image.AFFINE, (1, rng.uniform(-0.2, 0.2), 0, 0, 1, 0), Image.BILINEAR)
        if rng.rand() < 0.3: im = im.filter(ImageFilter.MinFilter(3))
    return np.array(im) > 110

t0 = time.time()
X, y = [], []
for i in range(len(Xtr)):
    X.append(normalize(mnist_mask(Xtr[i], False))); y.append(ytr[i])
    X.append(normalize(mnist_mask(Xtr[i], True))); y.append(ytr[i])
print('mnist klar', time.time() - t0, flush=True)
for fn in FONTS:
    for d in range(10):
        for v in range(70):
            X.append(normalize(font_mask(fn, d))); y.append(d)
print('fonte klar', len(X), time.time() - t0, flush=True)
X = np.array(X, np.float32).reshape(len(X), -1); y = np.array(y)

clf = MLPClassifier(hidden_layer_sizes=(256, 128), activation='relu', solver='adam', batch_size=256,
                    learning_rate_init=1e-3, max_iter=30, early_stopping=True, n_iter_no_change=4, random_state=0, verbose=True)
clf.fit(X, y)
print('træning', time.time() - t0, flush=True)

Xt = np.array([normalize(mnist_mask(x, False)) for x in Xte], np.float32).reshape(len(Xte), -1)
print('MNIST test (håndskrift, andre skribenter): %.2f%%' % (100 * (clf.predict(Xt) == yte).mean()))
Xh, yh = [], []
for fn in HELD:
    for d in range(10):
        for v in range(30): Xh.append(normalize(font_mask(fn, d))); yh.append(d)
print('Udeladte skrifttyper: %.2f%%' % (100 * (clf.predict(np.array(Xh).reshape(len(Xh), -1)) == np.array(yh)).mean()))

# eksport: int8-kvantiserede vægte
layers = []
for W, b in zip(clf.coefs_, clf.intercepts_):
    sc = float(np.abs(W).max() / 127)
    q = np.clip(np.round(W / sc), -127, 127).astype(np.int8)
    layers.append({'in': W.shape[0], 'out': W.shape[1], 'scale': sc,
                   'w': base64.b64encode(q.tobytes()).decode(), 'b': [round(float(v), 6) for v in b]})
# kontrol: kvantiseret model
def fwd(x):
    for i, L in enumerate(layers):
        W = np.frombuffer(base64.b64decode(L['w']), np.int8).reshape(L['in'], L['out']).astype(np.float32) * L['scale']
        x = x @ W + np.array(L['b'], np.float32)
        if i < len(layers) - 1: x = np.maximum(x, 0)
    return x
print('MNIST test efter kvantisering: %.2f%%' % (100 * (fwd(Xt).argmax(1) == yte).mean()))
open(OUT, 'w').write('window.DIGIT_MODEL = ' + json.dumps({'layers': layers}) + ';\n')
print('gemt', OUT)
