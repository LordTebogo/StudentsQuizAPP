from __future__ import annotations

import json
import math
import shutil
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
QUIZ_PATH = ROOT / "output" / "bioscientistapp_grade12_math_paper2_fun_quiz.json"
LIBRARY = ROOT / "quiz_image_library"
PACKAGE = ROOT / "output" / "bioscientistapp_grade12_math_paper2_package"
ZIP_PATH = ROOT / "output" / "bioscientistapp_grade12_math_paper2_package.zip"

W, H = 1200, 760
INK = "#12233f"
BLUE = "#1769aa"
TEAL = "#00897b"
ORANGE = "#e86a17"
PURPLE = "#7048b7"
RED = "#c83e4d"
GRID = "#d9e2ec"
PALE = "#f7fbff"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "arialbd.ttf" if bold else "arial.ttf"
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size)


F22, F26, F30, F36 = font(22), font(26), font(30, True), font(36, True)


def canvas(title: str):
    image = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((22, 22, W - 22, H - 22), radius=26, fill=PALE, outline="#b8c9dc", width=3)
    draw.text((55, 45), title, font=F30, fill=INK)
    draw.text((W - 210, H - 55), "NOT TO SCALE", font=F22, fill="#66788a")
    return image, draw


def label(draw, xy, text, color=INK, bold=True, anchor="mm", size=26):
    draw.text(xy, text, font=font(size, bold), fill=color, anchor=anchor)


def dot(draw, xy, color=INK, r=7):
    x, y = xy
    draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def save(image, filename: str):
    path = LIBRARY / filename
    image.save(path, "PNG", optimize=True)
    return path


def circle_points(cx, cy, radius, angles):
    return [(cx + radius * math.cos(math.radians(a)), cy - radius * math.sin(math.radians(a))) for a in angles]


def diagram_diameter(filename):
    im, d = canvas("Diameter and angle at the circumference")
    box = (300, 145, 900, 695)
    d.ellipse(box, outline=BLUE, width=7)
    A, B, C = (300, 420), (900, 420), (600, 145)
    d.line((A, B), fill=INK, width=6)
    d.line((A, C, B), fill=TEAL, width=6)
    for p in (A, B, C): dot(d, p)
    label(d, (270, 420), "A"); label(d, (930, 420), "B"); label(d, (600, 115), "C")
    label(d, (600, 230), "?", ORANGE, size=36)
    label(d, (600, 455), "diameter AB", BLUE, size=22)
    save(im, filename)


def diagram_cyclic(filename, angle_a=None, angle_c=None, title="Cyclic quadrilateral"):
    im, d = canvas(title)
    d.ellipse((285, 120, 915, 710), outline=BLUE, width=7)
    pts = circle_points(600, 415, 275, [145, 45, -35, -145])
    d.line(pts + [pts[0]], fill=TEAL, width=6, joint="curve")
    names = ["A", "B", "C", "D"]
    offsets = [(-28, -15), (28, -18), (30, 18), (-30, 18)]
    for p, n, off in zip(pts, names, offsets):
        dot(d, p); label(d, (p[0] + off[0], p[1] + off[1]), n)
    if angle_a: label(d, (pts[0][0] + 70, pts[0][1] + 35), angle_a, ORANGE)
    if angle_c: label(d, (pts[2][0] - 70, pts[2][1] - 35), angle_c, PURPLE)
    save(im, filename)


def diagram_alternate_segment(filename):
    im, d = canvas("Tangent–chord theorem")
    d.ellipse((300, 150, 860, 700), outline=BLUE, width=7)
    A, B, C = (350, 610), (810, 595), (630, 175)
    d.line((120, 670, 1040, 565), fill=INK, width=7)
    d.line((A, B, C, A), fill=TEAL, width=6)
    for p in (A, B, C): dot(d, p)
    label(d, (320, 625), "A"); label(d, (840, 610), "B"); label(d, (630, 140), "C")
    label(d, (670, 245), "38°", PURPLE)
    label(d, (280, 575), "?", ORANGE, size=36)
    label(d, (1000, 530), "tangent", INK, size=22)
    save(im, filename)


def proportional_triangle(filename, values=False, midpoint=False):
    title = "Basic proportionality theorem" if not midpoint else "Midpoint theorem"
    im, d = canvas(title)
    A, B, C = (600, 125), (210, 680), (990, 680)
    D, E = (425, 375), (775, 375)
    d.line((A, B, C, A), fill=BLUE, width=7)
    d.line((D, E), fill=TEAL, width=7)
    for p, n, off in [(A,"A",(0,-30)),(B,"B",(-30,15)),(C,"C",(30,15)),(D,"D",(-30,0)),(E,"E",(30,0))]:
        dot(d,p); label(d,(p[0]+off[0],p[1]+off[1]),n)
    label(d, (600, 345), "DE parallel BC", TEAL, size=22)
    if midpoint:
        label(d, (320, 505), "AD = DB", PURPLE, size=22)
        label(d, (880, 505), "AE = EC", PURPLE, size=22)
        label(d, (600, 710), "BC = 18 cm", ORANGE, size=22)
    elif values:
        label(d, (490, 245), "AD = 6", PURPLE, size=22)
        label(d, (315, 535), "DB = 3", PURPLE, size=22)
        label(d, (705, 245), "AE = 8", ORANGE, size=22)
        label(d, (885, 535), "EC = ?", ORANGE, size=22)
    else:
        label(d, (480, 245), "AD", PURPLE, size=22)
        label(d, (315, 530), "DB", PURPLE, size=22)
        label(d, (720, 245), "AE", ORANGE, size=22)
        label(d, (885, 530), "EC", ORANGE, size=22)
    save(im, filename)


def centre_angle(filename):
    im, d = canvas("Angle at the centre and circumference")
    d.ellipse((300, 130, 900, 710), outline=BLUE, width=7)
    O, A, B, C = (600, 420), (340, 555), (860, 555), (600, 130)
    d.line((A, O, B), fill=ORANGE, width=7)
    d.line((A, C, B), fill=TEAL, width=6)
    for p in (O,A,B,C): dot(d,p)
    for p,n,off in [(O,"O",(0,30)),(A,"A",(-28,15)),(B,"B",(28,15)),(C,"C",(0,-28))]: label(d,(p[0]+off[0],p[1]+off[1]),n)
    label(d, (600, 225), "42°", PURPLE)
    label(d, (600, 510), "?", ORANGE, size=36)
    save(im, filename)


def external_tangents(filename, symmetry=False):
    im, d = canvas("Tangents from a common external point")
    O, P = (460, 420), (1030, 420)
    r = 235
    d.ellipse((O[0]-r,O[1]-r,O[0]+r,O[1]+r), outline=BLUE, width=7)
    A, B = (555, 205), (555, 635)
    d.line((P,A), fill=TEAL, width=7); d.line((P,B), fill=TEAL, width=7)
    d.line((O,P), fill=PURPLE, width=5)
    d.line((A,B), fill=ORANGE, width=5)
    for p,n,off in [(O,"O",(-25,25)),(P,"P",(25,0)),(A,"A",(-5,-30)),(B,"B",(-5,30))]: dot(d,p); label(d,(p[0]+off[0],p[1]+off[1]),n)
    if symmetry:
        label(d, (790, 260), "PA and PB are tangents", TEAL, size=22)
    else:
        label(d, (795, 245), "PA = 7.5 cm", TEAL, size=24)
        label(d, (800, 605), "PB = ?", ORANGE, size=26)
    save(im, filename)


def coordinate_grid(d, x0=600, y0=420, scale=55):
    for i in range(-8,9):
        x=x0+i*scale; d.line((x,120,x,700),fill=GRID,width=2)
    for i in range(-5,6):
        y=y0-i*scale; d.line((150,y,1050,y),fill=GRID,width=2)
    d.line((150,y0,1050,y0),fill=INK,width=4); d.line((x0,700,x0,115),fill=INK,width=4)
    label(d,(1065,y0),"x",INK,size=22); label(d,(x0,100),"y",INK,size=22)
    return lambda x,y:(x0+x*scale,y0-y*scale)


def coordinate_circle(filename, mode):
    titles={"equation":"Circle with centre (3; −2)","perp":"Chord and perpendicular bisector","tangent169":"Tangent to a circle","diameter":"Circle defined by a diameter","tangentT":"Radius and tangent at T"}
    im,d=canvas(titles[mode]); scale = 25 if mode == "tangent169" else (45 if mode == "equation" else 55); xy=coordinate_grid(d, scale=scale)
    if mode=="equation":
        C=xy(3,-2); r=5*55; d.ellipse((C[0]-r,C[1]-r,C[0]+r,C[1]+r),outline=BLUE,width=6); dot(d,C,RED); label(d,(C[0]+25,C[1]+25),"C(3; −2)",RED,size=22)
    elif mode=="perp":
        A,B=xy(-2,0),xy(4,6); d.line((A,B),fill=BLUE,width=7); M=xy(1,3); d.line((xy(-4,8),xy(6,-2)),fill=ORANGE,width=6); dot(d,A);dot(d,B);dot(d,M,RED); label(d,(A[0]-35,A[1]+20),"A",size=22);label(d,(B[0]+30,B[1]-20),"B",size=22);label(d,(M[0]+35,M[1]+15),"M",RED,size=22); label(d,(860,630),"perpendicular bisector",ORANGE,size=22)
    elif mode=="tangent169":
        C=xy(0,0); r=13*scale; T=xy(5,12); d.ellipse((C[0]-r,C[1]-r,C[0]+r,C[1]+r),outline=BLUE,width=6); d.line((C,T),fill=PURPLE,width=6); dx,dy=T[0]-C[0],T[1]-C[1]; n=math.hypot(dx,dy); ux,uy=-dy/n,dx/n; d.line((T[0]-ux*480,T[1]-uy*480,T[0]+ux*480,T[1]+uy*480),fill=ORANGE,width=6); dot(d,C);dot(d,T,RED);label(d,(T[0]+55,T[1]-20),"T(5; 12)",RED,size=22);label(d,(C[0]-25,C[1]+25),"O",size=22)
    elif mode=="diameter":
        A,B=xy(-2,4),xy(6,-2); C=xy(2,1); r=5*55; d.ellipse((C[0]-r,C[1]-r,C[0]+r,C[1]+r),outline=BLUE,width=6); d.line((A,B),fill=TEAL,width=7); [dot(d,p) for p in (A,B,C)];label(d,(A[0]-45,A[1]-15),"A(−2; 4)",size=22);label(d,(B[0]+50,B[1]+15),"B(6; −2)",size=22);label(d,(C[0]+25,C[1]-25),"C",RED,size=22)
    else:
        C,T=xy(2,-1),xy(5,3); r=5*55; d.ellipse((C[0]-r,C[1]-r,C[0]+r,C[1]+r),outline=BLUE,width=6); d.line((C,T),fill=PURPLE,width=7); dx,dy=T[0]-C[0],T[1]-C[1]; n=math.hypot(dx,dy); ux,uy=-dy/n,dx/n; d.line((T[0]-ux*420,T[1]-uy*420,T[0]+ux*420,T[1]+uy*420),fill=ORANGE,width=6);dot(d,C);dot(d,T,RED);label(d,(C[0]-45,C[1]+25),"C(2; −1)",size=22);label(d,(T[0]+55,T[1]-15),"T(5; 3)",RED,size=22);label(d,(850,570),"tangent",ORANGE,size=22)
    save(im,filename)


def triangle_diagram(filename, mode):
    im,d=canvas("Triangle problem")
    A,B,C=(230,650),(960,650),(690,150)
    d.line((A,B,C,A),fill=BLUE,width=7)
    for p,n,off in [(A,"A",(-25,20)),(B,"B",(25,20)),(C,"C",(0,-28))]:dot(d,p);label(d,(p[0]+off[0],p[1]+off[1]),n)
    if mode=="sine":
        label(d,(290,595),"30°",ORANGE);label(d,(880,595),"45°",PURPLE);label(d,(830,390),"a = 10 cm",TEAL,size=24);label(d,(430,390),"b = ?",RED,size=26)
    else:
        label(d,(425,390),"5 cm",TEAL,size=24);label(d,(820,390),"7 cm",PURPLE,size=24);label(d,(675,235),"60°",ORANGE);label(d,(600,685),"?",RED,size=30)
    save(im,filename)


def quadrilateral_test(filename):
    im, d = canvas("Opposite angles in a quadrilateral")
    pts = [(330, 180), (880, 240), (930, 620), (250, 650)]
    d.line(pts + [pts[0]], fill=TEAL, width=7, joint="curve")
    for p, n, off in zip(pts, ["A", "B", "C", "D"], [(-25,-25),(25,-20),(25,20),(-25,20)]):
        dot(d, p); label(d, (p[0]+off[0],p[1]+off[1]), n)
    label(d, (390, 255), "112°", ORANGE)
    label(d, (830, 550), "68°", PURPLE)
    label(d, (600, 700), "What can be concluded?", INK, size=24)
    save(im, filename)


def similar_triangles(filename):
    im,d=canvas("Similar triangles and scale factor")
    small=[(120,620),(430,620),(340,330)]; large=[(610,650),(1080,650),(945,205)]
    d.line(small+[small[0]],fill=TEAL,width=7);d.line(large+[large[0]],fill=BLUE,width=7)
    label(d,(285,680),"area = 8 cm²",TEAL,size=24);label(d,(845,700),"area = ?",BLUE,size=26);label(d,(600,410),"linear scale factor ×3",ORANGE,size=26)
    save(im,filename)


def tangent_secant(filename):
    im,d=canvas("Tangent–secant theorem")
    d.ellipse((500,140,1040,690),outline=BLUE,width=7)
    P,A,B,T=(120,590),(520,500),(930,300),(610,650)
    d.line((P,B),fill=TEAL,width=7);d.line((P,T),fill=ORANGE,width=7)
    for p,n,off in [(P,"P",(-20,20)),(A,"A",(-5,-30)),(B,"B",(15,-20)),(T,"T",(15,25))]:dot(d,p);label(d,(p[0]+off[0],p[1]+off[1]),n)
    label(d,(350,520),"PA = 4 cm",TEAL,size=23);label(d,(760,360),"PB = 9 cm",TEAL,size=23);label(d,(360,640),"PT = ?",ORANGE,size=26)
    save(im,filename)


def tower(filename, moved=False):
    im,d=canvas("Angles of elevation")
    base,top=(900,650),(900,150);d.line((base,top),fill=INK,width=13);d.line((160,650,1050,650),fill=INK,width=7)
    if moved:
        near,far=(650,650),(400,650);d.line((near,top),fill=TEAL,width=5);d.line((far,top),fill=ORANGE,width=5);dot(d,near);dot(d,far);label(d,(775,400),"45°",TEAL);label(d,(525,420),"new angle ?",ORANGE,size=24);label(d,(530,690),"10 m farther",PURPLE,size=22);label(d,(950,400),"20 m",INK,size=24)
    else:
        obs=(240,650);d.line((obs,top),fill=TEAL,width=6);dot(d,obs);label(d,(330,610),"35°",ORANGE);label(d,(570,690),"50 m",PURPLE,size=24);label(d,(950,390),"height ?",RED,size=24)
    label(d,(900,690),"base",INK,size=22)
    save(im,filename)


def scatter(filename, mode):
    titles={"correlation":"Scatter plot for the data set","regression":"Least-squares regression line","extrapolation":"Interpolation versus extrapolation"}
    im,d=canvas(titles[mode]); x0,y0=180,650; d.line((x0,130,x0,y0,1080,y0),fill=INK,width=5)
    pts=[(1,1.7),(2,2.0),(3,3.4),(4,3.7),(5,5.3),(6,5.5),(7,6.9),(8,7.4),(9,8.1),(10,9.2)]
    def p(x,y):return(x0+x*70,y0-y*50)
    for x,y in pts: dot(d,p(x,y),BLUE,8)
    if mode!="correlation": d.line((p(0,1),p(12,10)),fill=ORANGE,width=5)
    if mode=="regression": label(d,(820,210),"ŷ = 2x + 3",ORANGE,size=26)
    if mode=="extrapolation":
        d.line((p(10,9), (1050,190)),fill=ORANGE,width=5); d.line((p(10,120/50),p(10,9)),fill="#8a98a8",width=3); label(d,(540,690),"observed x: 1 to 10",BLUE,size=22); label(d,(970,260),"x = 30?",RED,size=28)
    label(d,(1090,650),"x",size=22);label(d,(180,105),"y",size=22)
    save(im,filename)


def cosine_transform(filename):
    im,d=canvas("Transformation of a cosine graph")
    x0,y0=160,410;d.line((x0,120,x0,690,1080,690),fill=INK,width=4);d.line((x0,y0,1080,y0),fill=INK,width=4)
    pts=[]
    for deg in range(0,361,3):
        x=x0+deg*2.45;y=y0-(-2*math.cos(math.radians(deg-30))+1)*90;pts.append((x,y))
    d.line(pts,fill=PURPLE,width=6)
    for deg in (0,90,180,270,360): label(d,(x0+deg*2.45,675),f"{deg}°",size=20)
    label(d,(830,155),"y = −2cos(x − 30°) + 1",PURPLE,size=24)
    d.line((x0, y0-90,1080,y0-90), fill=ORANGE,width=3)
    label(d,(1050,y0-112),"y = 1",ORANGE,size=20)
    d.rectangle((760, 700, 1170, 735), fill=PALE)
    save(im,filename)


def build():
    LIBRARY.mkdir(parents=True, exist_ok=True)
    specs = {
        4: ("paper2_q04_diameter_angle.png", lambda f: diagram_diameter(f)),
        8: ("paper2_q08_cyclic_quadrilateral.png", lambda f: diagram_cyclic(f,"110°","?")),
        9: ("paper2_q09_alternate_segment.png", diagram_alternate_segment),
        17:("paper2_q17_proportionality.png", lambda f: proportional_triangle(f)),
        20:("paper2_q20_midpoint_theorem.png", lambda f: proportional_triangle(f,midpoint=True)),
        21:("paper2_q21_centre_angle.png", centre_angle),
        22:("paper2_q22_circle_equation.png", lambda f: coordinate_circle(f,"equation")),
        24:("paper2_q24_equal_tangents.png", lambda f: external_tangents(f)),
        25:("paper2_q25_correlation.png", lambda f: scatter(f,"correlation")),
        26:("paper2_q26_sine_rule.png", lambda f: triangle_diagram(f,"sine")),
        28:("paper2_q28_cyclic_test.png", quadrilateral_test),
        29:("paper2_q29_cosine_rule.png", lambda f: triangle_diagram(f,"cosine")),
        30:("paper2_q30_similar_areas.png", similar_triangles),
        34:("paper2_q34_perpendicular_bisector.png", lambda f: coordinate_circle(f,"perp")),
        35:("paper2_q35_regression.png", lambda f: scatter(f,"regression")),
        37:("paper2_q37_tangent_symmetry.png", lambda f: external_tangents(f,True)),
        40:("paper2_q40_tangent_secant.png", tangent_secant),
        41:("paper2_q41_circle_tangent.png", lambda f: coordinate_circle(f,"tangent169")),
        42:("paper2_q42_elevation.png", lambda f: tower(f)),
        43:("paper2_q43_proportional_values.png", lambda f: proportional_triangle(f,values=True)),
        44:("paper2_q44_moving_observer.png", lambda f: tower(f,True)),
        45:("paper2_q45_extrapolation.png", lambda f: scatter(f,"extrapolation")),
        46:("paper2_q46_cosine_transform.png", cosine_transform),
        47:("paper2_q47_diameter_circle.png", lambda f: coordinate_circle(f,"diameter")),
        50:("paper2_q50_tangent_at_t.png", lambda f: coordinate_circle(f,"tangentT")),
    }
    for _, (filename, maker) in specs.items(): maker(filename)

    data = json.loads(QUIZ_PATH.read_text(encoding="utf-8"))
    for number, (filename, _) in specs.items(): data["questions"][number-1]["image"] = filename
    QUIZ_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")

    if PACKAGE.exists(): shutil.rmtree(PACKAGE)
    PACKAGE.mkdir(parents=True)
    shutil.copy2(QUIZ_PATH, PACKAGE / QUIZ_PATH.name)
    for filename, _ in specs.values(): shutil.copy2(LIBRARY / filename, PACKAGE / filename)
    instructions = """BIOSCIENTISTAPP - GRADE 12 MATHEMATICS PAPER 2 FUN QUIZ

Contents
- bioscientistapp_grade12_math_paper2_fun_quiz.json
- 25 PNG examination-style diagrams

Import
1. Open the Tutor workspace.
2. Open 'Advanced options: import the original JSON format'.
3. Choose the assigned module.
4. Select bioscientistapp_grade12_math_paper2_fun_quiz.json.
5. Under 'Question images referenced by the JSON', select all 25 PNG files.
6. Choose 'Import and publish JSON'.

Quiz structure
- 50 scored primary questions worth 100 marks.
- 50 matched similar practice questions.
- 25 primary questions include diagrams.
- Similar practice questions do not support a separate image in the current app.
"""
    (PACKAGE / "IMPORT_INSTRUCTIONS.txt").write_text(instructions, encoding="utf-8")
    if ZIP_PATH.exists(): ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH,"w",zipfile.ZIP_DEFLATED) as z:
        for path in sorted(PACKAGE.iterdir()): z.write(path, path.name)
    print(f"Created {len(specs)} diagrams")
    print(f"Updated {QUIZ_PATH}")
    print(f"Created {ZIP_PATH}")


if __name__ == "__main__": build()
