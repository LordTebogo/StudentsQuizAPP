from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


SOURCE = Path(r"C:\Users\manyu\OneDrive\Pictures\Saved Pictures\27jUNE LadderH1N1NH.jpg.jpeg")
OUTPUT = Path(r"C:\Users\manyu\OneDrive\Documents\Programming\claude\files\27jUNE_LadderH1N1NH_marker_sizes.png")

# Crop includes the complete gel and a narrow untouched border. No resizing.
CROP = (630, 500, 1420, 1700)
LEFT_MARGIN, RIGHT_MARGIN, TOP_MARGIN, BOTTOM_MARGIN = 70, 180, 110, 105

src = Image.open(SOURCE).convert("RGB")
gel = src.crop(CROP)
canvas = Image.new(
    "RGB",
    (gel.width + LEFT_MARGIN + RIGHT_MARGIN, gel.height + TOP_MARGIN + BOTTOM_MARGIN),
    "black",
)
canvas.paste(gel, (LEFT_MARGIN, TOP_MARGIN))

draw = ImageDraw.Draw(canvas)
font_path = r"C:\Windows\Fonts\arial.ttf"
font_bold_path = r"C:\Windows\Fonts\arialbd.ttf"
label_font = ImageFont.truetype(font_bold_path, 18)
small_font = ImageFont.truetype(font_path, 15)
caption_font = ImageFont.truetype(font_path, 14)

# Lane centers from the source image, mapped without scaling to the canvas.
lane_centers_source = {
    "HA+NA": 1063,
    "NA": 1145,
    "HA": 1223,
    "Ladder": 1297,
}

for label, source_x in lane_centers_source.items():
    x = LEFT_MARGIN + source_x - CROP[0]
    box = draw.textbbox((0, 0), label, font=label_font)
    width = box[2] - box[0]
    draw.text((x - width / 2, 65), label, fill="white", font=label_font)
    draw.line((x, 90, x, TOP_MARGIN - 5), fill="white", width=2)

# Migration arrow is entirely in the added left margin.
arrow_x = 35
draw.line((arrow_x, TOP_MARGIN + 310, arrow_x, TOP_MARGIN + 90), fill="white", width=3)
draw.polygon(
    [(arrow_x, TOP_MARGIN + 76), (arrow_x - 7, TOP_MARGIN + 94), (arrow_x + 7, TOP_MARGIN + 94)],
    fill="white",
)
draw.text((8, TOP_MARGIN + 320), "Migration", fill="white", font=small_font)

caption = "Cropped and annotated only; gel pixels unchanged."
caption_box = draw.textbbox((0, 0), caption, font=caption_font)
caption_width = caption_box[2] - caption_box[0]
draw.text(
    ((canvas.width - caption_width) / 2, TOP_MARGIN + gel.height + 24),
    caption,
    fill="white",
    font=caption_font,
)

# Twelve visible bands. Values use a common 100 bp ladder pattern and account
# for migration upward from the wells at the bottom. Positions are source pixels.
marker_bands = [
    (613, "100"),
    (669, "200"),
    (720, "300"),
    (767, "400"),
    (809, "500"),
    (840, "600"),
    (871, "700"),
    (898, "800"),
    (920, "900"),
    (942, "1000"),
    (976, "1200"),
    (1025, "1500"),
]
ladder_x = LEFT_MARGIN + lane_centers_source["Ladder"] - CROP[0]
label_x = LEFT_MARGIN + gel.width + 28
for source_y, bp in marker_bands:
    y = TOP_MARGIN + source_y - CROP[1]
    draw.line((ladder_x + 22, y, label_x - 8, y), fill=(210, 210, 210), width=1)
    draw.text((label_x, y - 8), f"{bp} bp", fill="white", font=caption_font)

note = "Assumed common 100 bp Plus ladder; verify against the marker datasheet."
note2 = "Sample signal aligns roughly with the 400–1000 bp marker region (apparent only; plasmids are uncut)."
draw.text((LEFT_MARGIN, TOP_MARGIN + gel.height + 48), note, fill=(230, 230, 230), font=caption_font)
draw.text((LEFT_MARGIN, TOP_MARGIN + gel.height + 69), note2, fill=(230, 230, 230), font=caption_font)

# PNG avoids an additional lossy JPEG recompression.
canvas.save(OUTPUT, format="PNG", optimize=False)
print(OUTPUT)
