from __future__ import annotations

import json
import math
import shutil
import zipfile
from pathlib import Path

from PIL import ImageDraw

import build_grade12_math_paper2_diagrams as viz


ROOT = Path(__file__).resolve().parent
QUIZ_PATH = ROOT / "output" / "bioscientistapp_grade12_math_paper1_fun_quiz.json"
LIBRARY = ROOT / "quiz_image_library"
PACKAGE = ROOT / "output" / "bioscientistapp_grade12_math_paper1_package"
ZIP_PATH = ROOT / "output" / "bioscientistapp_grade12_math_paper1_package.zip"


def graph(title, xmin, xmax, ymin, ymax):
    image, draw = viz.canvas(title)
    left, top, right, bottom = 125, 125, 1080, 675
    sx, sy = (right-left)/(xmax-xmin), (bottom-top)/(ymax-ymin)
    xy = lambda x,y: (left+(x-xmin)*sx, bottom-(y-ymin)*sy)
    def nice_step(span):
        raw=span/10; power=10**math.floor(math.log10(raw)); ratio=raw/power
        return power*(5 if ratio>=5 else (2 if ratio>=2 else 1))
    xstep,ystep=nice_step(xmax-xmin),nice_step(ymax-ymin)
    xvalues=[];x=math.ceil(xmin/xstep)*xstep
    while x<=xmax+1e-9:xvalues.append(x);x+=xstep
    yvalues=[];y=math.ceil(ymin/ystep)*ystep
    while y<=ymax+1e-9:yvalues.append(y);y+=ystep
    for x in xvalues:
        px,_=xy(x,0); draw.line((px,top,px,bottom),fill=viz.GRID,width=2)
        if abs(x)>1e-9: draw.text((px+3,bottom-23),f"{x:g}",font=viz.font(16),fill="#52677d")
    for y in yvalues:
        _,py=xy(0,y); draw.line((left,py,right,py),fill=viz.GRID,width=2)
        if abs(y)>1e-9: draw.text((left+5,py-20),f"{y:g}",font=viz.font(16),fill="#52677d")
    if xmin <= 0 <= xmax:
        px,_=xy(0,0); draw.line((px,top,px,bottom),fill=viz.INK,width=4); viz.label(draw,(px,105),"y",size=22)
    if ymin <= 0 <= ymax:
        _,py=xy(0,0); draw.line((left,py,right,py),fill=viz.INK,width=4); viz.label(draw,(1100,py),"x",size=22)
    draw.rectangle((875,690,1170,735),fill=viz.PALE)
    return image, draw, xy, (xmin,xmax,ymin,ymax)


def plot(draw, xy, bounds, fn, color=viz.BLUE, width=6, steps=600):
    xmin,xmax,ymin,ymax=bounds; segment=[]
    for i in range(steps+1):
        x=xmin+(xmax-xmin)*i/steps
        try: y=fn(x)
        except (ValueError,ZeroDivisionError,OverflowError): y=None
        if y is None or not math.isfinite(y) or y<ymin or y>ymax:
            if len(segment)>1: draw.line(segment,fill=color,width=width)
            segment=[]
        else: segment.append(xy(x,y))
    if len(segment)>1: draw.line(segment,fill=color,width=width)


def dashed(draw, start, end, color=viz.ORANGE, width=4, parts=18):
    x1,y1=start;x2,y2=end
    for i in range(parts):
        if i%2==0: draw.line((x1+(x2-x1)*i/parts,y1+(y2-y1)*i/parts,x1+(x2-x1)*(i+1)/parts,y1+(y2-y1)*(i+1)/parts),fill=color,width=width)


def mark(draw, xy, x, y, text, color=viz.RED, offset=(35,-22)):
    p=xy(x,y);viz.dot(draw,p,color,8);viz.label(draw,(p[0]+offset[0],p[1]+offset[1]),text,color,size=22)


def line_graph(filename):
    im,d,xy,b=graph("Linear function: y = 2x − 3",-5,6,-8,8);plot(d,xy,b,lambda x:2*x-3,viz.TEAL);mark(d,xy,0,-3,"y-intercept",viz.ORANGE,(70,5));viz.save(im,filename)


def reciprocal_graph(filename, shifted=False):
    if shifted:
        im,d,xy,b=graph("Hyperbola: y = 2/(x − 1) + 4",-6,8,-4,10); fn=lambda x:2/(x-1); vx,hy=1,4; fn=lambda x:2/(x-1)+4
    else:
        im,d,xy,b=graph("Reciprocal function: y = 1/(x − 4)",-3,10,-6,6); vx,hy=4,0; fn=lambda x:1/(x-4)
    plot(d,xy,b,fn,viz.BLUE);dashed(d,xy(vx,b[2]),xy(vx,b[3]),viz.ORANGE);dashed(d,xy(b[0],hy),xy(b[1],hy),viz.PURPLE);viz.label(d,(xy(vx,hy)[0]+55,150),"vertical asymptote",viz.ORANGE,size=21);viz.label(d,(880,xy(vx,hy)[1]-24),"horizontal asymptote",viz.PURPLE,size=21);viz.save(im,filename)


def parabola(filename, mode):
    specs={
        "axis":("Parabola: y = (x − 2)² − 5",-4,8,-7,10,lambda x:(x-2)**2-5,(2,-5)),
        "turning":("Parabola: y = x² − 6x + 5",-3,9,-7,12,lambda x:x*x-6*x+5,(3,-4)),
        "increasing":("Increasing and decreasing intervals",-4,8,-7,12,lambda x:x*x-4*x,(2,-4)),
        "down":("Parabola: y = −2(x + 1)² + 3",-6,4,-10,6,lambda x:-2*(x+1)**2+3,(-1,3)),
        "tangent":("A horizontal tangent to a parabola",-3,7,-5,10,lambda x:x*x-4*x+3,(2,-1)),
    }
    title,xmin,xmax,ymin,ymax,fn,v=specs[mode];im,d,xy,b=graph(title,xmin,xmax,ymin,ymax);plot(d,xy,b,fn,viz.BLUE);mark(d,xy,*v,"turning point",viz.RED,(75,-20))
    if mode=="axis": dashed(d,xy(v[0],ymin),xy(v[0],ymax),viz.ORANGE)
    if mode=="increasing": d.line((xy(v[0],ymin)[0],xy(v[1]+1,ymin)[1],xy(xmax,ymin)[0],xy(v[1]+1,ymin)[1]),fill=viz.TEAL,width=8);viz.label(d,(850,630),"increasing",viz.TEAL,size=22)
    if mode=="tangent": d.line((xy(xmin,v[1]),xy(xmax,v[1])),fill=viz.ORANGE,width=6);viz.label(d,(850,xy(0,v[1])[1]-25),"y = k",viz.ORANGE,size=22)
    viz.save(im,filename)


def inverse_graph(filename, exponential=False):
    title="Exponential function and its inverse" if exponential else "A function and its inverse"
    im,d,xy,b=graph(title,-6,8,-6,10)
    plot(d,xy,b,lambda x:x,viz.ORANGE,4)
    if exponential:
        plot(d,xy,b,lambda x:2**x,viz.BLUE);plot(d,xy,b,lambda x:math.log(x,2) if x>0 else None,viz.PURPLE);viz.label(d,(920,180),"y = 2ˣ",viz.BLUE,size=24);viz.label(d,(900,500),"inverse",viz.PURPLE,size=24)
    else:
        plot(d,xy,b,lambda x:2*x+5,viz.BLUE);plot(d,xy,b,lambda x:(x-5)/2,viz.PURPLE);viz.label(d,(800,160),"f",viz.BLUE,size=25);viz.label(d,(890,510),"f inverse",viz.PURPLE,size=23)
    viz.label(d,(860,240),"y = x",viz.ORANGE,size=22);viz.save(im,filename)


def exponential_shift(filename):
    im,d,xy,b=graph("Exponential function: y = 2ˣ + 3",-6,5,0,12);plot(d,xy,b,lambda x:2**x+3,viz.BLUE);dashed(d,xy(-6,3),xy(5,3),viz.ORANGE);viz.label(d,(850,xy(0,3)[1]-25),"horizontal asymptote",viz.ORANGE,size=22);viz.save(im,filename)


def tangent_cubic(filename):
    im,d,xy,b=graph("Tangent to f(x) = x³ − 2x",-3,4,-12,15);plot(d,xy,b,lambda x:x**3-2*x,viz.BLUE);plot(d,xy,b,lambda x:10*(x-2)+6,viz.ORANGE,5);mark(d,xy,2,6,"x = 2",viz.RED,(35,-25));viz.save(im,filename)


def intersections(filename):
    im,d,xy,b=graph("Intersections of y = x² and y = 2x + 3",-5,6,-5,14);plot(d,xy,b,lambda x:x*x,viz.BLUE);plot(d,xy,b,lambda x:2*x+3,viz.TEAL);mark(d,xy,-1,1,"P",viz.RED);mark(d,xy,3,9,"Q",viz.RED);viz.save(im,filename)


def rectangle_area(filename):
    im,d,xy,b=graph("Area of a rectangle with perimeter 40 m",0,20,0,110);plot(d,xy,b,lambda w:w*(20-w),viz.BLUE);mark(d,xy,10,100,"maximum area",viz.RED,(80,-15));viz.label(d,(930,620),"width",size=22);viz.label(d,(235,150),"area",size=22);viz.save(im,filename)


def cubic(filename, mode):
    if mode=="inflection": title,fn,bounds,marks="Cubic function and its point of inflection",lambda x:x**3-3*x*x+2,(-3,5,-18,20),[(1,0,"inflection")]
    elif mode=="stationary": title,fn,bounds,marks="Stationary points of f(x) = x³ − 12x",lambda x:x**3-12*x,(-5,5,-22,22),[(-2,16,"P"),(2,-16,"Q")]
    else: title,fn,bounds,marks="Graph of f(x) = x³ − 3x",lambda x:x**3-3*x,(-3,3,-5,5),[(-1,2,"P"),(1,-2,"Q"),(0,0,"O")]
    im,d,xy,b=graph(title,*bounds);plot(d,xy,b,fn,viz.BLUE)
    for x,y,t in marks: mark(d,xy,x,y,t,viz.RED)
    viz.save(im,filename)


def line_circle(filename):
    im,d,xy,b=graph("Line and circle intersections",-7,7,-7,7);plot(d,xy,b,lambda x:math.sqrt(25-x*x) if abs(x)<=5 else None,viz.BLUE);plot(d,xy,b,lambda x:-math.sqrt(25-x*x) if abs(x)<=5 else None,viz.BLUE);plot(d,xy,b,lambda x:x+1,viz.TEAL);mark(d,xy,3,4,"P",viz.RED);mark(d,xy,-4,-3,"Q",viz.RED);viz.save(im,filename)


def rectangle_under_curve(filename):
    im,d,xy,b=graph("Rectangle under y = 12 − x²",0,4,0,13);plot(d,xy,b,lambda x:12-x*x,viz.BLUE);x,y=2,8;p0,p1,p2,p3=xy(0,0),xy(x,0),xy(x,y),xy(0,y);d.line((p0,p1,p2,p3,p0),fill=viz.ORANGE,width=6);viz.label(d,(xy(1,4)),"area",viz.ORANGE,size=24);viz.save(im,filename)


def displacement(filename):
    im,d,xy,b=graph("Displacement: s(t) = t³ − 6t² + 9t",0,6,-5,22);plot(d,xy,b,lambda t:t**3-6*t*t+9*t,viz.BLUE);mark(d,xy,2,2,"t = 2",viz.RED,(40,-25));viz.label(d,(1020,650),"time t",size=22);viz.label(d,(250,145),"s(t)",size=22);viz.save(im,filename)


def profit(filename):
    im,d,xy,b=graph("Profit as a function of items sold",0,90,-1500,3500);plot(d,xy,b,lambda x:-2*x*x+180*x-1000,viz.BLUE);mark(d,xy,45,3050,"maximum",viz.RED,(65,-15));viz.label(d,(950,650),"items x",size=22);viz.save(im,filename)


def build():
    LIBRARY.mkdir(parents=True,exist_ok=True)
    specs={
        4:("paper1_q04_linear_graph.png",line_graph),8:("paper1_q08_reciprocal_domain.png",lambda f:reciprocal_graph(f)),13:("paper1_q13_axis_symmetry.png",lambda f:parabola(f,"axis")),18:("paper1_q18_inverse_function.png",lambda f:inverse_graph(f)),19:("paper1_q19_turning_point.png",lambda f:parabola(f,"turning")),23:("paper1_q23_exponential_asymptote.png",exponential_shift),25:("paper1_q25_tangent_gradient.png",tangent_cubic),28:("paper1_q28_function_intersections.png",intersections),29:("paper1_q29_increasing_interval.png",lambda f:parabola(f,"increasing")),32:("paper1_q32_downward_parabola.png",lambda f:parabola(f,"down")),33:("paper1_q33_rectangle_area.png",rectangle_area),35:("paper1_q35_inflection.png",lambda f:cubic(f,"inflection")),37:("paper1_q37_exponential_inverse.png",lambda f:inverse_graph(f,True)),38:("paper1_q38_stationary_points.png",lambda f:cubic(f,"stationary")),40:("paper1_q40_hyperbola_range.png",lambda f:reciprocal_graph(f,True)),41:("paper1_q41_line_circle.png",line_circle),42:("paper1_q42_horizontal_tangent.png",lambda f:parabola(f,"tangent")),43:("paper1_q43_rectangle_under_curve.png",rectangle_under_curve),48:("paper1_q48_cubic_features.png",lambda f:cubic(f,"features")),49:("paper1_q49_displacement.png",displacement),50:("paper1_q50_profit.png",profit),
    }
    for _,(filename,maker) in specs.items():maker(filename)
    data=json.loads(QUIZ_PATH.read_text(encoding="utf-8"))
    for number,(filename,_) in specs.items():data["questions"][number-1]["image"]=filename
    QUIZ_PATH.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    if PACKAGE.exists():shutil.rmtree(PACKAGE)
    PACKAGE.mkdir(parents=True);shutil.copy2(QUIZ_PATH,PACKAGE/QUIZ_PATH.name)
    for filename,_ in specs.values():shutil.copy2(LIBRARY/filename,PACKAGE/filename)
    instructions="""BIOSCIENTISTAPP - GRADE 12 MATHEMATICS PAPER 1 FUN QUIZ

Contents
- bioscientistapp_grade12_math_paper1_fun_quiz.json
- 21 PNG examination-style graphs and diagrams

Import
1. Open the Tutor workspace.
2. Open 'Advanced options: import the original JSON format'.
3. Choose the assigned module.
4. Select bioscientistapp_grade12_math_paper1_fun_quiz.json.
5. Under 'Question images referenced by the JSON', select all 21 PNG files.
6. Choose 'Import and publish JSON'.

Quiz structure
- 50 scored primary questions worth 100 marks.
- Every primary question has a matched similar question and keyed answer.
- 21 primary questions include graphs or diagrams.
- When a similar question is open, BioscientistApp now reveals that similar question's answer rather than the original answer.
"""
    (PACKAGE/"IMPORT_INSTRUCTIONS.txt").write_text(instructions,encoding="utf-8")
    if ZIP_PATH.exists():ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH,"w",zipfile.ZIP_DEFLATED) as z:
        for path in sorted(PACKAGE.iterdir()):z.write(path,path.name)
    print(f"Created {len(specs)} diagrams");print(f"Updated {QUIZ_PATH}");print(f"Created {ZIP_PATH}")


if __name__=="__main__":build()
