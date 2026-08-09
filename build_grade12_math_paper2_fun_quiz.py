import json
from pathlib import Path


OUT = Path(__file__).resolve().parent / "output" / "bioscientistapp_grade12_math_paper2_fun_quiz.json"


def mcq(question, options, answer, marks, explanation, similar_question, similar_options, similar_answer, reading_page=None):
    item = {
        "type": "mcq",
        "question": question,
        "options": options,
        "answer": answer,
        "marks": marks,
        "explanation": explanation,
        "similar_question": similar_question,
        "similar_options": similar_options,
        "similar_correct_answer": similar_answer,
    }
    if reading_page:
        item["reading_page"] = reading_page
    return item


questions = [
    mcq(
        "Find the median of 2, 4, 6, 8, 10.",
        ["6", "5", "7", "8"], "6", 1,
        "The data are ordered and there are five values. The middle value is 6.",
        "Find the median of 3, 5, 7, 9.",
        ["6", "5", "7", "8"], "6",
        {"title": "Level 1: Secure the fundamentals", "text": "Begin with direct statistics, coordinate geometry, basic trigonometric ratios and core circle theorems. Draw a quick diagram whenever it helps."}
    ),
    mcq(
        "Find the distance between A(1; 2) and B(4; 6).",
        ["5 units", "7 units", "4 units", "√7 units"], "5 units", 1,
        "AB = √[(4 - 1)² + (6 - 2)²] = √(9 + 16) = 5.",
        "Find the distance between C(-1; 3) and D(2; 7).",
        ["5 units", "4 units", "7 units", "√13 units"], "5 units"
    ),
    mcq(
        "In a right-angled triangle, which ratio equals sin θ?",
        ["Opposite/Hypotenuse", "Adjacent/Hypotenuse", "Opposite/Adjacent", "Hypotenuse/Opposite"], "Opposite/Hypotenuse", 1,
        "By definition, sin θ is the length of the side opposite θ divided by the hypotenuse.",
        "In a right-angled triangle, which ratio equals cos θ?",
        ["Adjacent/Hypotenuse", "Opposite/Hypotenuse", "Opposite/Adjacent", "Hypotenuse/Adjacent"], "Adjacent/Hypotenuse"
    ),
    mcq(
        "AB is a diameter of a circle and C is a point on the circle. What is the size of angle ACB?",
        ["90°", "180°", "45°", "60°"], "90°", 1,
        "The angle subtended by a diameter at the circumference is 90°.",
        "PQ is a diameter and R lies on the circle. What type of angle is PRQ?",
        ["A right angle", "A straight angle", "An acute angle only", "A reflex angle"], "A right angle"
    ),
    mcq(
        "For the data 1, 2, 3, 4, 5, 6, 7, 8, find the interquartile range.",
        ["4", "3", "4.5", "7"], "4", 1,
        "Q₁ = 2.5 and Q₃ = 6.5, so IQR = Q₃ - Q₁ = 4.",
        "For the data 2, 4, 6, 8, 10, 12, find the interquartile range.",
        ["6", "4", "8", "10"], "6"
    ),
    mcq(
        "Find the midpoint of A(2; -1) and B(6; 5).",
        ["(4; 2)", "(8; 4)", "(2; 4)", "(4; 3)"], "(4; 2)", 1,
        "Average the x-coordinates and y-coordinates: ((2 + 6)/2; (-1 + 5)/2) = (4; 2).",
        "Find the midpoint of C(-4; 2) and D(2; 8).",
        ["(-1; 5)", "(1; 5)", "(-2; 10)", "(-1; 3)"], "(-1; 5)"
    ),
    mcq(
        "Evaluate sin 30°.",
        ["1/2", "√3/2", "1", "0"], "1/2", 1,
        "The exact value of sin 30° is 1/2.",
        "Evaluate cos 60°.",
        ["1/2", "√3/2", "1", "0"], "1/2"
    ),
    mcq(
        "One angle of a cyclic quadrilateral is 110°. Find the opposite angle.",
        ["70°", "110°", "80°", "250°"], "70°", 1,
        "Opposite angles of a cyclic quadrilateral are supplementary: 180° - 110° = 70°.",
        "One angle of a cyclic quadrilateral is 95°. Find the opposite angle.",
        ["85°", "95°", "75°", "265°"], "85°"
    ),
    mcq(
        "The angle in the alternate segment is 38°. What is the angle between the tangent and the chord?",
        ["38°", "52°", "76°", "142°"], "38°", 1,
        "By the tangent-chord theorem, the angle between a tangent and a chord equals the angle in the alternate segment.",
        "The angle between a tangent and a chord is 47°. What is the angle in the alternate segment?",
        ["47°", "43°", "94°", "133°"], "47°"
    ),
    mcq(
        "What does a small standard deviation indicate?",
        ["The data are clustered close to the mean", "The data have a very large range", "The mean is zero", "There are no data values"], "The data are clustered close to the mean", 1,
        "Standard deviation measures spread around the mean. A small value indicates relatively little spread.",
        "What is the usual effect of an extreme outlier on standard deviation?",
        ["It increases the standard deviation", "It always makes the standard deviation zero", "It has no effect", "It changes the median into the mean"], "It increases the standard deviation"
    ),
    mcq(
        "Find the gradient of the line through A(-2; 1) and B(4; 13).",
        ["2", "3", "1/2", "-2"], "2", 1,
        "m = (13 - 1)/(4 - (-2)) = 12/6 = 2.",
        "Find the gradient of the line through C(1; -3) and D(5; 5).",
        ["2", "1/2", "-2", "8"], "2"
    ),
    mcq(
        "Complete the identity: 1 - sin²θ = ...",
        ["cos²θ", "tan²θ", "sin²θ", "1/cos²θ"], "cos²θ", 1,
        "The fundamental identity sin²θ + cos²θ = 1 gives 1 - sin²θ = cos²θ.",
        "Complete the identity: tan θ = ...",
        ["sin θ/cos θ", "cos θ/sin θ", "1/sin θ", "1/cos θ"], "sin θ/cos θ"
    ),
    mcq(
        "Two triangles have two pairs of equal corresponding angles. Which conclusion follows?",
        ["The triangles are similar by AA", "The triangles are congruent by SSS", "The triangles have equal areas", "The triangles must be right-angled"], "The triangles are similar by AA", 1,
        "Two equal corresponding angles guarantee that the third angles are equal, so the triangles are similar by AA.",
        "If two triangles are similar, what is true about corresponding sides?",
        ["They are proportional", "They are always equal", "They are perpendicular", "They add to 180°"], "They are proportional"
    ),
    mcq(
        "Find the equation of the line with gradient 3 passing through (2; -1).",
        ["y = 3x - 7", "y = 3x + 5", "y = 2x - 3", "y = -3x + 5"], "y = 3x - 7", 1,
        "Use y - y₁ = m(x - x₁): y + 1 = 3(x - 2), so y = 3x - 7.",
        "Find the equation of the line with gradient -2 passing through (1; 4).",
        ["y = -2x + 6", "y = 2x + 2", "y = -2x + 2", "y = 4x - 2"], "y = -2x + 6"
    ),
    mcq(
        "Solve sin x = 1/2 for 0° ≤ x ≤ 360°.",
        ["x = 30° or 150°", "x = 60° or 300°", "x = 30° or 330°", "x = 150° or 210°"], "x = 30° or 150°", 1,
        "The reference angle is 30°. Sine is positive in quadrants I and II, giving 30° and 150°.",
        "Solve cos x = 1/2 for 0° ≤ x ≤ 360°.",
        ["x = 60° or 300°", "x = 30° or 150°", "x = 60° or 120°", "x = 120° or 240°"], "x = 60° or 300°"
    ),
    mcq(
        "A data set has Q₁ = 12 and Q₃ = 20. Is the value 34 an outlier using the 1.5(IQR) rule?",
        ["Yes, because the upper fence is 32", "No, because the upper fence is 40", "No, because 34 is below Q₃", "Yes, because every value above the mean is an outlier"], "Yes, because the upper fence is 32", 2,
        "IQR = 8 and the upper fence is 20 + 1.5(8) = 32. Since 34 > 32, it is an outlier.",
        "A data set has Q₁ = 8 and Q₃ = 14. Is the value 25 an outlier using the 1.5(IQR) rule?",
        ["Yes, because the upper fence is 23", "No, because the upper fence is 25", "No, because 25 is positive", "Yes, because the IQR is 14"], "Yes, because the upper fence is 23",
        {"title": "Level 2: Link the theorems and formulas", "text": "These questions need several connected steps. Use quartile fences, coordinate relationships, reduction formulas, graph features and Euclidean proportionality carefully."}
    ),
    mcq(
        "In triangle ABC, D lies on AB and E lies on AC, with DE parallel to BC. If AD/DB = 2/3, find AE/EC.",
        ["2/3", "3/2", "2/5", "3/5"], "2/3", 2,
        "A line parallel to one side of a triangle divides the other two sides proportionally, so AD/DB = AE/EC.",
        "In triangle PQR, S lies on PQ and T lies on PR, with ST parallel to QR. If PS/SQ = 4/5, find PT/TR.",
        ["4/5", "5/4", "4/9", "5/9"], "4/5"
    ),
    mcq(
        "A line has gradient 2/3. What is the gradient of a line perpendicular to it?",
        ["-3/2", "3/2", "-2/3", "2/3"], "-3/2", 2,
        "The gradients of perpendicular non-vertical lines multiply to -1, so the negative reciprocal is -3/2.",
        "A line has gradient -4. What is the gradient of a perpendicular line?",
        ["1/4", "-1/4", "4", "-4"], "1/4"
    ),
    mcq(
        "Simplify sin(180° - θ).",
        ["sin θ", "-sin θ", "cos θ", "-cos θ"], "sin θ", 2,
        "The angle 180° - θ lies in quadrant II, where sine is positive, and its reference angle is θ.",
        "Simplify cos(180° - θ).",
        ["-cos θ", "cos θ", "sin θ", "-sin θ"], "-cos θ"
    ),
    mcq(
        "D and E are the midpoints of AB and AC in triangle ABC. If BC = 18 cm, find DE.",
        ["9 cm", "18 cm", "6 cm", "36 cm"], "9 cm", 2,
        "The segment joining the midpoints of two sides of a triangle is half the length of the third side.",
        "S and T are the midpoints of PQ and PR in triangle PQR. If QR = 22 cm, find ST.",
        ["11 cm", "22 cm", "44 cm", "7.33 cm"], "11 cm"
    ),
    mcq(
        "An angle at the circumference subtending an arc is 42°. Find the angle at the centre subtending the same arc.",
        ["84°", "42°", "21°", "138°"], "84°", 2,
        "The angle at the centre is twice the angle at the circumference standing on the same arc.",
        "An angle at the circumference is 35°. Find the angle at the centre on the same arc.",
        ["70°", "35°", "17.5°", "145°"], "70°"
    ),
    mcq(
        "State the centre and radius of (x - 3)² + (y + 2)² = 25.",
        ["Centre (3; -2), radius 5", "Centre (-3; 2), radius 25", "Centre (3; 2), radius 5", "Centre (-3; -2), radius 25"], "Centre (3; -2), radius 5", 2,
        "Compare with (x - a)² + (y - b)² = r². Here a = 3, b = -2 and r = 5.",
        "State the centre and radius of (x + 4)² + (y - 1)² = 9.",
        ["Centre (-4; 1), radius 3", "Centre (4; -1), radius 9", "Centre (-4; -1), radius 3", "Centre (4; 1), radius 9"], "Centre (-4; 1), radius 3"
    ),
    mcq(
        "State the amplitude and period of y = 2sin x.",
        ["Amplitude 2; period 360°", "Amplitude 1; period 180°", "Amplitude 2; period 180°", "Amplitude 360; period 2°"], "Amplitude 2; period 360°", 2,
        "The coefficient 2 gives the amplitude, while sin x has period 360°.",
        "State the amplitude and period of y = cos(2x).",
        ["Amplitude 1; period 180°", "Amplitude 2; period 360°", "Amplitude 1; period 360°", "Amplitude 2; period 180°"], "Amplitude 1; period 180°"
    ),
    mcq(
        "Tangents PA and PB are drawn from the same external point P. If PA = 7.5 cm, find PB.",
        ["7.5 cm", "15 cm", "3.75 cm", "Cannot be determined"], "7.5 cm", 2,
        "Tangents drawn from the same external point to a circle are equal in length.",
        "Tangents PX and PY are drawn from P. If PX = 12 cm, find PY.",
        ["12 cm", "24 cm", "6 cm", "Cannot be determined"], "12 cm"
    ),
    mcq(
        "A data set has correlation coefficient r = 0.92. How should the linear relationship be described?",
        ["Strong positive correlation", "Strong negative correlation", "Weak positive correlation", "No correlation"], "Strong positive correlation", 2,
        "A value close to +1 indicates a strong positive linear relationship.",
        "A data set has correlation coefficient r = -0.88. How should the linear relationship be described?",
        ["Strong negative correlation", "Strong positive correlation", "Weak negative correlation", "No correlation"], "Strong negative correlation"
    ),
    mcq(
        "In triangle ABC, A = 30°, B = 45° and side a = 10 cm. Find side b.",
        ["10√2 cm", "5√2 cm", "20 cm", "10/√3 cm"], "10√2 cm", 2,
        "By the sine rule, b/sin45° = 10/sin30°, so b = 10(√2/2)/(1/2) = 10√2 cm.",
        "In triangle PQR, P = 30°, R = 90° and side p = 5 cm. Find side r.",
        ["10 cm", "5√3 cm", "2.5 cm", "5 cm"], "10 cm"
    ),
    mcq(
        "The gradient of a radius at the point of contact is 1/2. What is the gradient of the tangent?",
        ["-2", "2", "-1/2", "1/2"], "-2", 2,
        "A tangent is perpendicular to the radius at the point of contact, so its gradient is the negative reciprocal.",
        "The gradient of a radius at the point of contact is -3. What is the gradient of the tangent?",
        ["1/3", "-1/3", "3", "-3"], "1/3"
    ),
    mcq(
        "A quadrilateral has one pair of opposite angles measuring 112° and 68°. What can be concluded?",
        ["The quadrilateral is cyclic", "The quadrilateral is a parallelogram", "The quadrilateral is a square", "Nothing can be concluded"], "The quadrilateral is cyclic", 2,
        "The opposite angles are supplementary. By the converse of the cyclic-quadrilateral theorem, the quadrilateral is cyclic.",
        "A quadrilateral has opposite angles of 103° and 77°. What can be concluded?",
        ["The quadrilateral is cyclic", "The quadrilateral is a rhombus", "The quadrilateral is a rectangle", "The diagonals are equal"], "The quadrilateral is cyclic"
    ),
    mcq(
        "Two sides of a triangle are 5 cm and 7 cm, with an included angle of 60°. Find the third side.",
        ["√39 cm", "√109 cm", "6 cm", "12 cm"], "√39 cm", 2,
        "By the cosine rule, c² = 5² + 7² - 2(5)(7)cos60° = 39.",
        "Two sides are 6 cm and 8 cm, with an included angle of 60°. Find the third side.",
        ["2√13 cm", "10 cm", "√28 cm", "14 cm"], "2√13 cm"
    ),
    mcq(
        "Two triangles are similar with a linear scale factor of 3 from the smaller to the larger. If the smaller area is 8 cm², find the larger area.",
        ["72 cm²", "24 cm²", "48 cm²", "216 cm²"], "72 cm²", 2,
        "Areas of similar figures are in the square of the linear scale factor: 8 × 3² = 72.",
        "The linear scale factor from a smaller triangle to a larger one is 2.5. If the smaller area is 6 cm², find the larger area.",
        ["37.5 cm²", "15 cm²", "30 cm²", "93.75 cm²"], "37.5 cm²"
    ),
    mcq(
        "Does the point (4; 3) lie on the circle x² + y² = 25?",
        ["Yes, because 4² + 3² = 25", "No, because 4 + 3 ≠ 25", "Yes, because 4 × 3 = 12", "No, because both coordinates must be negative"], "Yes, because 4² + 3² = 25", 2,
        "Substitute the coordinates: 16 + 9 = 25, so the point lies on the circle.",
        "Does the point (5; 12) lie on the circle x² + y² = 169?",
        ["Yes, because 5² + 12² = 169", "No, because 5 + 12 ≠ 169", "No, because 5 × 12 = 60", "Yes, because 169 is prime"], "Yes, because 5² + 12² = 169"
    ),
    mcq(
        "Find the area of a triangle with sides 8 cm and 10 cm enclosing an angle of 30°.",
        ["20 cm²", "40 cm²", "80 cm²", "10 cm²"], "20 cm²", 2,
        "Area = 1/2 ab sin C = 1/2(8)(10)sin30° = 20 cm².",
        "Find the area of a triangle with sides 6 cm and 9 cm enclosing an angle of 60°.",
        ["27√3/2 cm²", "27 cm²", "54√3 cm²", "15 cm²"], "27√3/2 cm²"
    ),
    mcq(
        "Solve tan x = -1 for 0° ≤ x ≤ 360°.",
        ["x = 135° or 315°", "x = 45° or 225°", "x = 135° or 225°", "x = 45° or 315°"], "x = 135° or 315°", 2,
        "The reference angle is 45°. Tangent is negative in quadrants II and IV.",
        "Solve sin x = -√3/2 for 0° ≤ x ≤ 360°.",
        ["x = 240° or 300°", "x = 60° or 120°", "x = 120° or 240°", "x = 210° or 330°"], "x = 240° or 300°"
    ),
    mcq(
        "A chord has endpoints A(-2; 0) and B(4; 6). Find the equation of its perpendicular bisector.",
        ["y = -x + 4", "y = x + 2", "y = -x - 4", "y = x - 2"], "y = -x + 4", 2,
        "The midpoint is (1; 3), the chord gradient is 1, and the perpendicular gradient is -1. Thus y - 3 = -(x - 1).",
        "A chord has endpoints C(0; 2) and D(6; 2). Find the equation of its perpendicular bisector.",
        ["x = 3", "y = 3", "x = 2", "y = 2"], "x = 3"
    ),
    mcq(
        "A least-squares regression line is ŷ = 2x + 3. Predict y when x = 4.",
        ["11", "8", "7", "14"], "11", 2,
        "Substitute x = 4: ŷ = 2(4) + 3 = 11.",
        "A least-squares regression line is ŷ = -1.5x + 10. Predict y when x = 2.",
        ["7", "13", "8.5", "5"], "7"
    ),
    mcq(
        "Give the general solution of sin x = sin 40°.",
        ["x = 40° + 360°k or x = 140° + 360°k", "x = 40° + 180°k only", "x = 320° + 360°k only", "x = 140° + 180°k only"], "x = 40° + 360°k or x = 140° + 360°k", 3,
        "For sin x = sin α, x = α + 360°k or x = 180° - α + 360°k.",
        "Give the general solution of cos x = cos 70°.",
        ["x = 360°k ± 70°", "x = 70° + 180°k", "x = 110° + 360°k", "x = 290° + 180°k"], "x = 360°k ± 70°",
        {"title": "Level 3: Full exam reasoning", "text": "Use general solutions, rigorous theorem logic, circle equations, identities and regression interpretation. Keep exact values until the final step."}
    ),
    mcq(
        "O is the centre of a circle and PA and PB are tangents from P. Which facts show that OP is the perpendicular bisector of AB?",
        ["OA = OB and PA = PB", "OA is parallel to PB", "AB is a diameter", "Angles OAP and OBP are both 45°"], "OA = OB and PA = PB", 3,
        "Both O and P are equidistant from A and B. Therefore OP is the perpendicular bisector of AB.",
        "Points X and Y are equidistant from both A and B. Where must X and Y lie?",
        ["On the perpendicular bisector of AB", "On a line parallel to AB", "On the circle with diameter AB only", "At the midpoint of AB only"], "On the perpendicular bisector of AB"
    ),
    mcq(
        "Find the equation of the circle with centre (2; -1) passing through (5; 3).",
        ["(x - 2)² + (y + 1)² = 25", "(x + 2)² + (y - 1)² = 25", "(x - 5)² + (y - 3)² = 5", "(x - 2)² + (y + 1)² = 5"], "(x - 2)² + (y + 1)² = 25", 3,
        "The radius is √[(5 - 2)² + (3 + 1)²] = 5, so r² = 25.",
        "Find the equation of the circle with centre (-1; 2) passing through (2; 6).",
        ["(x + 1)² + (y - 2)² = 25", "(x - 1)² + (y + 2)² = 25", "(x + 1)² + (y - 2)² = 5", "(x - 2)² + (y - 6)² = 25"], "(x + 1)² + (y - 2)² = 25"
    ),
    mcq(
        "Simplify (1 - cos 2x)/sin x, where the expression is defined.",
        ["2sin x", "2cos x", "sin x", "tan x"], "2sin x", 3,
        "Use 1 - cos 2x = 2sin²x, then divide by sin x to obtain 2sin x.",
        "Simplify sin 2x/(1 + cos 2x), where the expression is defined.",
        ["tan x", "2tan x", "sin x", "cot x"], "tan x"
    ),
    mcq(
        "From external point P, PT is tangent and PAB is a secant. If PA = 4 cm and PB = 9 cm, find PT.",
        ["6 cm", "13 cm", "√13 cm", "4.5 cm"], "6 cm", 3,
        "By the tangent-secant theorem, PT² = PA × PB = 4 × 9 = 36, so PT = 6 cm.",
        "From external point Q, QT is tangent and QCD is a secant. If QC = 5 cm and QD = 20 cm, find QT.",
        ["10 cm", "15 cm", "√15 cm", "12.5 cm"], "10 cm"
    ),
    mcq(
        "Find the equation of the tangent to x² + y² = 169 at the point (5; 12).",
        ["5x + 12y = 169", "12x + 5y = 169", "5x - 12y = 169", "y = (12/5)x"], "5x + 12y = 169", 3,
        "The radius has gradient 12/5, so the tangent has gradient -5/12. The tangent through (5; 12) simplifies to 5x + 12y = 169.",
        "Find the equation of the tangent to x² + y² = 25 at the point (3; 4).",
        ["3x + 4y = 25", "4x + 3y = 25", "3x - 4y = 25", "y = (4/3)x"], "3x + 4y = 25"
    ),
    mcq(
        "From a point 50 m from the base of a vertical tower, the angle of elevation is 35°. Find the tower's height to the nearest metre.",
        ["35 m", "41 m", "29 m", "61 m"], "35 m", 3,
        "tan35° = height/50, so height = 50tan35° ≈ 35.0 m.",
        "From a point 30 m from the base of a vertical building, the angle of elevation is 40°. Find the height to the nearest metre.",
        ["25 m", "19 m", "36 m", "23 m"], "25 m"
    ),
    mcq(
        "In triangle ABC, D lies on AB and E lies on AC, with DE parallel to BC. If AD = 6, DB = 3 and AE = 8, find EC.",
        ["4", "12", "16", "6"], "4", 3,
        "Parallel lines divide the sides proportionally: AD/DB = AE/EC. Thus 6/3 = 8/EC, giving EC = 4.",
        "In triangle PQR, S lies on PQ and T lies on PR, with ST parallel to QR. If PS = 4, SQ = 6 and PT = 10, find TR.",
        ["15", "12", "6.67", "20"], "15"
    ),
    mcq(
        "A 20 m tower is seen at an elevation angle of 45°. An observer then moves 10 m directly away from the tower. What is the new angle of elevation, to the nearest degree?",
        ["34°", "45°", "27°", "56°"], "34°", 3,
        "At 45°, the original horizontal distance is 20 m. The new distance is 30 m, so θ = arctan(20/30) ≈ 34°.",
        "A 15 m tower is seen at 45°. An observer moves 5 m directly away. What is the new angle of elevation, to the nearest degree?",
        ["37°", "45°", "30°", "53°"], "37°"
    ),
    mcq(
        "A regression model was built using x-values from 1 to 10. Why is predicting at x = 30 potentially unreliable?",
        ["It is extrapolation far beyond the observed data", "Regression can never predict a value", "The correlation coefficient must equal zero", "x-values may not be positive"], "It is extrapolation far beyond the observed data", 3,
        "A relationship observed between x = 1 and x = 10 may not continue to x = 30, so the prediction is an uncertain extrapolation.",
        "What does a correlation coefficient close to zero mean?",
        ["There is little or no linear relationship", "There is definitely no relationship of any kind", "There is a perfect negative relationship", "The variables have equal means"], "There is little or no linear relationship"
    ),
    mcq(
        "Describe y = -2cos(x - 30°) + 1 relative to y = cos x.",
        ["Amplitude 2, reflected, shifted 30° right and 1 up", "Amplitude 1, shifted 30° left and 2 up", "Amplitude 2, shifted 30° left and 1 down", "Amplitude -2 and period 30°"], "Amplitude 2, reflected, shifted 30° right and 1 up", 3,
        "The factor -2 reflects the graph and gives amplitude 2. The term x - 30° shifts it right, and +1 shifts it upward.",
        "Describe y = 3sin(x + 45°) - 2 relative to y = sin x.",
        ["Amplitude 3, shifted 45° left and 2 down", "Amplitude 3, shifted 45° right and 2 up", "Amplitude 1, shifted 3° left and 2 down", "Amplitude -3 and period 45°"], "Amplitude 3, shifted 45° left and 2 down",
        {"title": "Level 4: Paper 2 challenge zone", "text": "The final questions integrate diagrams, transformations and multi-step modelling. State the theorem or relationship you are using before calculating."}
    ),
    mcq(
        "A and B are endpoints of a diameter with A(-2; 4) and B(6; -2). Find the circle's equation.",
        ["(x - 2)² + (y - 1)² = 25", "(x + 2)² + (y + 1)² = 25", "(x - 4)² + (y - 2)² = 100", "x² + y² = 25"], "(x - 2)² + (y - 1)² = 25", 3,
        "The centre is the midpoint (2; 1). The diameter length is 10, so the radius is 5 and r² = 25.",
        "C and D are endpoints of a diameter with C(1; -3) and D(7; 5). Find the circle's equation.",
        ["(x - 4)² + (y - 1)² = 25", "(x + 4)² + (y + 1)² = 25", "(x - 3)² + (y - 4)² = 100", "x² + y² = 25"], "(x - 4)² + (y - 1)² = 25"
    ),
    mcq(
        "Solve 2sin(2x) = 1 for 0° ≤ x < 360°.",
        ["x = 15°, 75°, 195° or 255°", "x = 30°, 150°, 210° or 330°", "x = 15°, 165°, 195° or 345°", "x = 75°, 105°, 255° or 285°"], "x = 15°, 75°, 195° or 255°", 3,
        "sin(2x) = 1/2. For 0° ≤ 2x < 720°, 2x = 30°, 150°, 390° or 510°, giving the four stated x-values.",
        "Solve cos(2x) = -1/2 for 0° ≤ x < 360°.",
        ["x = 60°, 120°, 240° or 300°", "x = 30°, 150°, 210° or 330°", "x = 120° or 240°", "x = 60° or 300°"], "x = 60°, 120°, 240° or 300°"
    ),
    mcq(
        "Solve cos(2x) = sin x for 0° ≤ x < 360°.",
        ["x = 30°, 150° or 270°", "x = 0°, 120° or 240°", "x = 45°, 135° or 225°", "x = 60°, 180° or 300°"], "x = 30°, 150° or 270°", 3,
        "Use cos2x = 1 - 2sin²x. Then 2sin²x + sinx - 1 = 0, so sinx = 1/2 or -1.",
        "Solve cos(2x) = cos x for 0° ≤ x < 360°.",
        ["x = 0°, 120° or 240°", "x = 30°, 150° or 270°", "x = 60°, 180° or 300°", "x = 90° or 270°"], "x = 0°, 120° or 240°"
    ),
    mcq(
        "A circle has centre C(2; -1), and T(5; 3) lies on the circle. Find the equation of the tangent at T.",
        ["3x + 4y = 27", "4x + 3y = 29", "3x - 4y = 3", "y = (4/3)x - 1"], "3x + 4y = 27", 3,
        "The radius CT has gradient 4/3, so the tangent gradient is -3/4. Using T(5; 3) gives 3x + 4y = 27.",
        "A circle has centre C(-1; 2), and T(2; 6) lies on it. Find the equation of the tangent at T.",
        ["3x + 4y = 30", "4x + 3y = 26", "3x - 4y = -18", "y = (4/3)x + 2"], "3x + 4y = 30"
    ),
]


data = {
    "title": "Fun Quiz: Grade 12 Mathematics Paper 2 Challenge",
    "is_fun": True,
    "fun_level": "expert",
    "questions": questions,
}


if __name__ == "__main__":
    assert len(questions) == 50
    for index, question in enumerate(questions, 1):
        assert question["type"] == "mcq"
        assert len(question["options"]) == 4
        assert question["answer"] in question["options"], (index, "primary answer")
        assert len(question["similar_options"]) == 4
        assert question["similar_correct_answer"] in question["similar_options"], (index, "similar answer")
        assert question["explanation"] and question["similar_question"]
    assert sum(question["marks"] for question in questions) == 100
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Created {OUT}")
    print(f"Primary questions: {len(questions)}; similar practice questions: {len(questions)}")
    print(f"Primary marks: {sum(question['marks'] for question in questions)}")
