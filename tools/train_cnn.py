"""Træner ciffer-CNN'en og eksporterer den til js/digit-model.js (int8-kvantiseret).

Brug: python tools/train_cnn.py <data.npz fra make_digit_data.py> <mnist-mappe> <ud.js>
"""
import os, sys, json, base64, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from digitnorm import normalize

torch.manual_seed(0)
data, mn, out = sys.argv[1], sys.argv[2], sys.argv[3]
EPOCHS = int(os.environ.get('EPOCHS', 10))


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.c1 = nn.Conv2d(1, 16, 3, padding=1)
        self.c2 = nn.Conv2d(16, 16, 3, padding=1)
        self.c3 = nn.Conv2d(16, 32, 3, padding=1)
        self.f1 = nn.Linear(32 * 7 * 7, 128)
        self.f2 = nn.Linear(128, 11)
        self.drop = nn.Dropout(0.3)

    def forward(self, x):
        x = F.relu(self.c1(x))
        x = F.max_pool2d(F.relu(self.c2(x)), 2)
        x = F.max_pool2d(F.relu(self.c3(x)), 2)
        x = self.drop(F.relu(self.f1(x.flatten(1))))
        return self.f2(x)


d = np.load(data)
X = torch.tensor(d['X'], dtype=torch.float32).unsqueeze(1) / 255.0
y = torch.tensor(d['y'])
perm = torch.randperm(len(X))
nval = len(X) // 30
Xv, yv, Xt, yt = X[perm[:nval]], y[perm[:nval]], X[perm[nval:]], y[perm[nval:]]
print('træning', len(Xt), 'validering', len(Xv), flush=True)


def load_idx(path):
    b = open(path, 'rb').read()
    return np.frombuffer(b[16:], np.uint8).reshape(-1, 28, 28) if b[3] == 3 else np.frombuffer(b[8:], np.uint8)


from PIL import Image
mt, ml = load_idx(mn + '/t10k-images-idx3-ubyte'), load_idx(mn + '/t10k-labels-idx1-ubyte')
Xm = torch.tensor(np.array([normalize(np.array(Image.fromarray(im).resize((84, 84), Image.BILINEAR)) > 110) for im in mt]),
                  dtype=torch.float32).unsqueeze(1)
ym = torch.tensor(ml.astype(np.int64))

net = Net()
opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
steps = EPOCHS * (len(Xt) // 256 + 1)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=steps)


def accuracy(Xe, ye):
    net.eval()
    with torch.no_grad():
        p = torch.cat([net(Xe[i:i + 4096]).argmax(1) for i in range(0, len(Xe), 4096)])
    net.train()
    return (p == ye).float().mean().item() * 100


t0 = time.time()
for ep in range(EPOCHS):
    idx = torch.randperm(len(Xt))
    for i in range(0, len(Xt), 256):
        b = idx[i:i + 256]
        xb = Xt[b]
        # lille tilfældig forskydning (±1 px) for robusthed
        if torch.rand(1).item() < 0.5:
            xb = torch.roll(xb, shifts=(int(torch.randint(-1, 2, (1,))), int(torch.randint(-1, 2, (1,)))), dims=(2, 3))
        loss = F.cross_entropy(net(xb), yt[b], label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    print(f'epoke {ep + 1}/{EPOCHS}: val {accuracy(Xv, yv):.2f}%  MNIST-test {accuracy(Xm, ym):.2f}%  ({time.time() - t0:.0f}s)', flush=True)


# ---- eksport (int8 pr. lag) ----
def q(t):
    a = t.detach().numpy().astype(np.float32)
    sc = float(np.abs(a).max() / 127) or 1.0
    return sc, base64.b64encode(np.clip(np.round(a / sc), -127, 127).astype(np.int8).tobytes()).decode()


layers = []
for conv in [net.c1, net.c2, 'pool', net.c3, 'pool']:
    if conv == 'pool':
        layers.append({'type': 'pool'}); continue
    sc, w = q(conv.weight)
    layers.append({'type': 'conv', 'in': conv.in_channels, 'out': conv.out_channels, 'scale': sc, 'w': w,
                   'b': [round(float(v), 6) for v in conv.bias.detach()]})
for i, fc in enumerate([net.f1, net.f2]):
    sc, w = q(fc.weight)
    layers.append({'type': 'dense', 'in': fc.in_features, 'out': fc.out_features, 'relu': i == 0, 'scale': sc, 'w': w,
                   'b': [round(float(v), 6) for v in fc.bias.detach()]})

# kontrol: samme model med kvantiserede vægte
with torch.no_grad():
    for m in [net.c1, net.c2, net.c3, net.f1, net.f2]:
        sc = m.weight.abs().max() / 127
        m.weight.copy_(torch.round(m.weight / sc).clamp(-127, 127) * sc)
print(f'MNIST-test efter kvantisering: {accuracy(Xm, ym):.2f}%')
open(out, 'w').write('window.DIGIT_MODEL = ' + json.dumps({'type': 'cnn', 'classes': 11, 'layers': layers}) + ';\n')
print('gemt', out, os.path.getsize(out) // 1024, 'KB')
