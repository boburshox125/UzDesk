"""Generates host/assets/uzdesk.ico and uzdesk.png (run once; outputs are committed)."""
import os
from PIL import Image, ImageDraw

S = 256
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "host", "assets")
os.makedirs(OUT, exist_ok=True)


def lerp(a, b, k):
    return tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))


grad = Image.new("RGBA", (S, S))
A, B, C = (108, 92, 231), (79, 70, 229), (8, 145, 178)
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * S)
        col = lerp(A, B, t / .5) if t < .5 else lerp(B, C, (t - .5) / .5)
        grad.putpixel((x, y), col + (255,))
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((8, 8, S - 8, S - 8), 56, fill=255)
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)
d.rounded_rectangle((52, 66, 204, 166), 16, outline="white", width=16)
d.line((128, 170, 128, 196), fill="white", width=16)
d.line((90, 200, 166, 200), fill="white", width=16)
d.arc((100, 98, 156, 154), 200, 340, fill=(103, 232, 249), width=12)
d.ellipse((118, 124, 138, 144), fill=(103, 232, 249))
img.save(os.path.join(OUT, "uzdesk.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.save(os.path.join(OUT, "uzdesk.png"))
print("ok")
