from PIL import Image, ImageDraw, ImageFont
import os

OUT = r"D:\zhongyiqianduan\dist\中医工作台-本机版\app.ico"
SIZE = 512
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 墨绿圆角底
radius = int(SIZE * 0.22)
d.rounded_rectangle([0, 0, SIZE, SIZE], radius=radius, fill=(47, 93, 80, 255))
# 内圈淡描边
d.rounded_rectangle(
    [int(SIZE * 0.05), int(SIZE * 0.05), int(SIZE * 0.95), int(SIZE * 0.95)],
    radius=int(radius * 0.85),
    outline=(231, 239, 233, 90),
    width=max(2, int(SIZE * 0.012)),
)

font = None
for path, index in [
    (r"C:\Windows\Fonts\simsun.ttc", 0),
    (r"C:\Windows\Fonts\msyh.ttc", 0),
    (r"C:\Windows\Fonts\simhei.ttf", 0),
]:
    if os.path.exists(path):
        try:
            font = ImageFont.truetype(path, int(SIZE * 0.62), index=index)
            break
        except Exception:
            continue

if font is None:
    raise SystemExit("no CJK font found")

text = "医"
box = d.textbbox((0, 0), text, font=font)
w, h = box[2] - box[0], box[3] - box[1]
d.text(((SIZE - w) / 2 - box[0], (SIZE - h) / 2 - box[1] - SIZE * 0.01), text, font=font, fill=(231, 239, 233, 255))

img.save(OUT, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ico saved", OUT, os.path.getsize(OUT))
