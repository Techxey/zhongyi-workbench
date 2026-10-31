from PIL import Image, ImageDraw, ImageFilter
import random

W, H = 760, 560
random.seed(7)
img = Image.new("RGB", (W, H), (238, 226, 214))
d = ImageDraw.Draw(img)

# 背景：诊室光下的肤色渐变
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=(int(240 - 8 * t), int(228 - 10 * t), int(216 - 12 * t)))

# 舌头主体
cx, cy = W // 2, 300
d.ellipse([cx - 175, cy - 150, cx + 175, cy + 120], fill=(184, 84, 88))
d.ellipse([cx - 160, cy - 138, cx + 160, cy + 104], fill=(196, 96, 99))
# 舌面纹理
for _ in range(900):
    x = random.randint(cx - 150, cx + 150)
    y = random.randint(cy - 125, cy + 92)
    if ((x - cx) / 155) ** 2 + ((y - cy) / 118) ** 2 > 1:
        continue
    c = random.choice([(206, 112, 114), (182, 88, 92), (214, 130, 130)])
    d.point((x, y), fill=c)
# 中心浅裂纹
d.line([(cx - 6, cy - 100), (cx + 2, cy + 40)], fill=(178, 84, 88), width=3)
d.line([(cx + 2, cy + 40), (cx - 12, cy + 82)], fill=(178, 84, 88), width=2)

# 薄白苔（上中部）
for _ in range(2600):
    x = random.randint(cx - 130, cx + 120)
    y = random.randint(cy - 110, cy - 10)
    if ((x - cx) / 135) ** 2 + ((y - cy) / 105) ** 2 > 1:
        continue
    d.point((x, y), fill=(230, 214, 210))

# 舌边（淡红偏暗）
d.arc([cx - 178, cy - 152, cx + 178, cy + 122], 200, 340, fill=(150, 62, 68), width=6)

# 嘴唇轮廓暗示
d.arc([cx - 250, cy - 232, cx + 250, cy + 210], 250, 290, fill=(206, 166, 158), width=14)
d.arc([cx - 250, cy - 232, cx + 250, cy + 210], 70, 110, fill=(206, 166, 158), width=14)

img = img.filter(ImageFilter.GaussianBlur(0.6))
img.save(r"D:\zhongyiqianduan\tmp-uploads\tongue-photo.png")
print("saved", img.size)
