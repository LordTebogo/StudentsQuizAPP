from pathlib import Path
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent
OUT=ROOT/"tmp"/"quiz_qa"
OUT.mkdir(parents=True,exist_ok=True)
PDFS=[ROOT/"output"/"SBIA022_Metabolic_Mission_Student_Quiz.pdf",ROOT/"output"/"SBIA022_Metabolic_Mission_Lecturer_Memo.pdf"]
font=ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf",24)

for pdf_path in PDFS:
    pdf=pdfium.PdfDocument(str(pdf_path))
    pages=[]
    for i,page in enumerate(pdf):
        bitmap=page.render(scale=100/72)
        im=bitmap.to_pil().convert("RGB")
        pages.append(im)
    for group_start in range(0,len(pages),4):
        group=pages[group_start:group_start+4]
        w=max(i.width for i in group); h=max(i.height for i in group)
        sheet=Image.new("RGB",(w*2+60,h*2+100),"#D9DEDC")
        draw=ImageDraw.Draw(sheet)
        for j,im in enumerate(group):
            x=20+(j%2)*(w+20); y=50+(j//2)*(h+20)
            sheet.paste(im,(x,y))
            draw.text((x,16+(j//2)*(h+20)),f"Page {group_start+j+1}",font=font,fill="#17332D")
        name=f"{pdf_path.stem}_pages_{group_start+1:02d}-{group_start+len(group):02d}.png"
        sheet.save(OUT/name,optimize=True)
print("Rendered QA sheets to",OUT)
