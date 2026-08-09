import json
from pathlib import Path


OUT = Path(__file__).resolve().parent / "output" / "bioscientistapp_grade12_math_paper1_fun_quiz.json"


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
        "Solve for x: x + 5 = 12.",
        ["x = 7", "x = 5", "x = 12", "x = 17"], "x = 7", 1,
        "Subtract 5 from both sides: x = 12 - 5 = 7.",
        "Solve for x: 3x = 15.",
        ["x = 5", "x = 12", "x = 3", "x = 45"], "x = 5",
        {"title": "Level 1: Build momentum", "text": "Start with direct algebra, basic patterns, familiar graphs, introductory finance, simple derivatives and elementary probability. Work accurately before moving to the multi-step questions."}
    ),
    mcq(
        "Factorise completely: x² + 5x + 6.",
        ["(x + 2)(x + 3)", "(x - 2)(x - 3)", "(x + 1)(x + 6)", "(x - 1)(x - 6)"], "(x + 2)(x + 3)", 1,
        "The two numbers must multiply to 6 and add to 5. Those numbers are 2 and 3.",
        "Factorise completely: x² - 7x + 12.",
        ["(x - 3)(x - 4)", "(x + 3)(x + 4)", "(x - 2)(x - 6)", "(x + 2)(x + 6)"], "(x - 3)(x - 4)"
    ),
    mcq(
        "Find the common difference of the arithmetic sequence 3, 7, 11, 15, ...",
        ["4", "3", "7", "8"], "4", 1,
        "Subtract consecutive terms: 7 - 3 = 4 and 11 - 7 = 4.",
        "Find the common difference of the arithmetic sequence 12, 9, 6, 3, ...",
        ["-3", "3", "-6", "9"], "-3"
    ),
    mcq(
        "For the function y = 2x - 3, what is the y-intercept?",
        ["-3", "2", "3", "-2"], "-3", 1,
        "At the y-intercept, x = 0. Therefore y = 2(0) - 3 = -3.",
        "For the function y = -4x + 5, what is the y-intercept?",
        ["5", "-4", "4", "-5"], "5"
    ),
    mcq(
        "R1 000 is invested at 10% simple interest per year for 2 years. What is the final amount?",
        ["R1 200", "R1 210", "R1 100", "R2 000"], "R1 200", 1,
        "Use A = P(1 + in): A = 1 000(1 + 0.10 × 2) = R1 200.",
        "R1 500 is invested at 8% simple interest per year for 3 years. What is the final amount?",
        ["R1 860", "R1 889", "R1 740", "R1 620"], "R1 860"
    ),
    mcq(
        "Simplify: 2³ × 2⁴.",
        ["2⁷ = 128", "2¹² = 4 096", "4⁷", "2¹ = 2"], "2⁷ = 128", 1,
        "When multiplying powers with the same base, add the exponents: 2³ × 2⁴ = 2⁷ = 128.",
        "Simplify: 3² × 3³.",
        ["3⁵ = 243", "3⁶ = 729", "9⁵", "3¹ = 3"], "3⁵ = 243"
    ),
    mcq(
        "Find the nth term of the arithmetic sequence 5, 8, 11, 14, ...",
        ["Tₙ = 3n + 2", "Tₙ = 5n + 3", "Tₙ = 3n + 5", "Tₙ = 2n + 3"], "Tₙ = 3n + 2", 1,
        "For an arithmetic sequence, Tₙ = a + (n - 1)d = 5 + 3(n - 1) = 3n + 2.",
        "Find the nth term of the arithmetic sequence 2, 6, 10, 14, ...",
        ["Tₙ = 4n - 2", "Tₙ = 2n + 4", "Tₙ = 4n + 2", "Tₙ = 6n - 4"], "Tₙ = 4n - 2"
    ),
    mcq(
        "State the domain restriction of f(x) = 1/(x - 4).",
        ["x ≠ 4", "x ≠ -4", "x > 4", "x < 4"], "x ≠ 4", 1,
        "The denominator may not equal zero. Since x - 4 = 0 when x = 4, that value is excluded.",
        "State the domain restriction of g(x) = 3/(x + 2).",
        ["x ≠ -2", "x ≠ 2", "x > -2", "x < 2"], "x ≠ -2"
    ),
    mcq(
        "Differentiate f(x) = x³.",
        ["f′(x) = 3x²", "f′(x) = x²", "f′(x) = 3x", "f′(x) = x⁴/4"], "f′(x) = 3x²", 1,
        "Apply the power rule: d(xⁿ)/dx = nxⁿ⁻¹. Therefore d(x³)/dx = 3x².",
        "Differentiate g(x) = 5x².",
        ["g′(x) = 10x", "g′(x) = 5x", "g′(x) = 10x²", "g′(x) = 2x"], "g′(x) = 10x"
    ),
    mcq(
        "A fair six-sided die is rolled. What is the probability of obtaining an even number?",
        ["1/2", "1/3", "2/3", "1/6"], "1/2", 1,
        "The even outcomes are 2, 4 and 6: three favourable outcomes out of six, so 3/6 = 1/2.",
        "A fair six-sided die is rolled. What is the probability of obtaining a number greater than 4?",
        ["1/3", "1/2", "2/3", "1/6"], "1/3"
    ),
    mcq(
        "Solve: x² - 5x + 6 = 0.",
        ["x = 2 or x = 3", "x = -2 or x = -3", "x = 1 or x = 6", "x = -1 or x = -6"], "x = 2 or x = 3", 1,
        "Factorise: x² - 5x + 6 = (x - 2)(x - 3). Set each factor equal to zero.",
        "Solve: x² + x - 6 = 0.",
        ["x = 2 or x = -3", "x = -2 or x = 3", "x = 1 or x = -6", "x = -1 or x = 6"], "x = 2 or x = -3"
    ),
    mcq(
        "Find the common ratio of the geometric sequence 2, 6, 18, 54, ...",
        ["3", "2", "6", "9"], "3", 1,
        "Divide a term by the preceding term: 6/2 = 3 and 18/6 = 3.",
        "Find the common ratio of the geometric sequence 64, 32, 16, 8, ...",
        ["1/2", "2", "-2", "1/4"], "1/2"
    ),
    mcq(
        "What is the axis of symmetry of y = (x - 2)² - 5?",
        ["x = 2", "x = -2", "y = -5", "y = 2"], "x = 2", 1,
        "In turning-point form y = a(x - p)² + q, the axis of symmetry is x = p.",
        "What is the axis of symmetry of y = (x + 3)² + 1?",
        ["x = -3", "x = 3", "y = 1", "y = -3"], "x = -3"
    ),
    mcq(
        "R2 000 is invested at 5% compound interest per year for 2 years. What is the final amount?",
        ["R2 205", "R2 200", "R2 210", "R2 100"], "R2 205", 1,
        "Use A = P(1 + i)ⁿ: A = 2 000(1.05)² = R2 205.",
        "R5 000 is invested at 10% compound interest per year for 2 years. What is the final amount?",
        ["R6 050", "R6 000", "R5 500", "R6 100"], "R6 050"
    ),
    mcq(
        "Differentiate f(x) = 4x³ - 3x² + 2.",
        ["f′(x) = 12x² - 6x", "f′(x) = 12x² - 3x", "f′(x) = 4x² - 6x", "f′(x) = 12x³ - 6x²"], "f′(x) = 12x² - 6x", 1,
        "Apply the power rule term by term. The derivative of the constant 2 is zero.",
        "Differentiate g(x) = 3x⁴ + 2x.",
        ["g′(x) = 12x³ + 2", "g′(x) = 7x³", "g′(x) = 12x⁴ + 2x", "g′(x) = 3x³ + 2"], "g′(x) = 12x³ + 2"
    ),
    mcq(
        "Solve the inequality: 2x - 6 > 0.",
        ["x > 3", "x < 3", "x > -3", "x < -3"], "x > 3", 2,
        "Add 6 and divide by 2: 2x > 6, so x > 3.",
        "Solve the inequality: -3x + 9 ≥ 0.",
        ["x ≤ 3", "x ≥ 3", "x ≤ -3", "x ≥ -3"], "x ≤ 3",
        {"title": "Level 2: Connect the methods", "text": "The next questions require two or more linked steps. Watch inequality signs, distinguish arithmetic from geometric patterns, and connect equations to graphical meaning."}
    ),
    mcq(
        "Calculate the sum of the first 10 terms of 3, 5, 7, 9, ...",
        ["120", "110", "100", "210"], "120", 2,
        "Here a = 3, d = 2 and T₁₀ = 21. Thus S₁₀ = 10/2(3 + 21) = 120.",
        "Calculate the sum of the first 8 terms of 5, 8, 11, 14, ...",
        ["124", "116", "108", "248"], "124"
    ),
    mcq(
        "If f(x) = 2x + 5, determine f⁻¹(x).",
        ["f⁻¹(x) = (x - 5)/2", "f⁻¹(x) = 2x - 5", "f⁻¹(x) = (x + 5)/2", "f⁻¹(x) = 1/(2x + 5)"], "f⁻¹(x) = (x - 5)/2", 2,
        "Write y = 2x + 5, interchange x and y, and solve for y: y = (x - 5)/2.",
        "If g(x) = 3x - 4, determine g⁻¹(x).",
        ["g⁻¹(x) = (x + 4)/3", "g⁻¹(x) = 3x + 4", "g⁻¹(x) = (x - 4)/3", "g⁻¹(x) = 1/(3x - 4)"], "g⁻¹(x) = (x + 4)/3"
    ),
    mcq(
        "Find the turning point of f(x) = x² - 6x + 5.",
        ["(3; -4)", "(-3; -4)", "(3; 4)", "(-3; 4)"], "(3; -4)", 2,
        "Set f′(x) = 2x - 6 equal to zero, giving x = 3. Then f(3) = -4.",
        "Find the turning point of g(x) = x² + 4x - 1.",
        ["(-2; -5)", "(2; -5)", "(-2; 5)", "(2; 5)"], "(-2; -5)"
    ),
    mcq(
        "Events A and B are independent, with P(A) = 0.4 and P(B) = 0.5. Find P(A and B).",
        ["0.20", "0.90", "0.10", "0.45"], "0.20", 2,
        "For independent events, P(A and B) = P(A)P(B) = 0.4 × 0.5 = 0.20.",
        "Events C and D are independent, with P(C) = 0.3 and P(D) = 0.6. Find P(C and D).",
        ["0.18", "0.90", "0.30", "0.50"], "0.18"
    ),
    mcq(
        "For which value of k does x² - 4x + k = 0 have equal roots?",
        ["k = 4", "k = -4", "k = 8", "k = 16"], "k = 4", 2,
        "Equal roots occur when the discriminant is zero: (-4)² - 4(1)(k) = 0, so k = 4.",
        "For which value of m does x² + 6x + m = 0 have equal roots?",
        ["m = 9", "m = -9", "m = 6", "m = 36"], "m = 9"
    ),
    mcq(
        "Find the nth term of the geometric sequence 2, 6, 18, 54, ...",
        ["Tₙ = 2(3)ⁿ⁻¹", "Tₙ = 3(2)ⁿ⁻¹", "Tₙ = 2 + 3(n - 1)", "Tₙ = 6(3)ⁿ"], "Tₙ = 2(3)ⁿ⁻¹", 2,
        "For a geometric sequence, Tₙ = arⁿ⁻¹. Here a = 2 and r = 3.",
        "Find the nth term of the geometric sequence 81, 27, 9, 3, ...",
        ["Tₙ = 81(1/3)ⁿ⁻¹", "Tₙ = 27(3)ⁿ⁻¹", "Tₙ = 81 - 54(n - 1)", "Tₙ = 3(81)ⁿ⁻¹"], "Tₙ = 81(1/3)ⁿ⁻¹"
    ),
    mcq(
        "State the horizontal asymptote of y = 2ˣ + 3.",
        ["y = 3", "x = 3", "y = 2", "x = 0"], "y = 3", 2,
        "The graph y = 2ˣ is shifted 3 units upward, so its horizontal asymptote becomes y = 3.",
        "State the horizontal asymptote of y = 5ˣ⁻¹ - 2.",
        ["y = -2", "x = 1", "y = 2", "x = -2"], "y = -2"
    ),
    mcq(
        "A nominal interest rate of 12% per year is compounded monthly. What is the monthly rate?",
        ["1% per month", "12% per month", "0.12% per month", "6% per month"], "1% per month", 2,
        "Divide the nominal annual rate by 12: 12%/12 = 1% per month.",
        "A nominal interest rate of 8% per year is compounded quarterly. What is the quarterly rate?",
        ["2% per quarter", "8% per quarter", "4% per quarter", "0.8% per quarter"], "2% per quarter"
    ),
    mcq(
        "Find the gradient of the tangent to f(x) = x³ - 2x at x = 2.",
        ["10", "8", "12", "6"], "10", 2,
        "f′(x) = 3x² - 2. Therefore f′(2) = 12 - 2 = 10.",
        "Find the gradient of the tangent to g(x) = x² + 3x at x = 1.",
        ["5", "4", "3", "6"], "5"
    ),
    mcq(
        "If P(A) = 0.73, find P(not A).",
        ["0.27", "0.73", "1.73", "0.37"], "0.27", 2,
        "An event and its complement have probabilities that add to 1. Thus P(not A) = 1 - 0.73 = 0.27.",
        "If P(B) = 0.62, find P(not B).",
        ["0.38", "0.62", "1.62", "0.48"], "0.38"
    ),
    mcq(
        "In the sequence Tₙ = 3(2)ⁿ⁻¹, which term is equal to 48?",
        ["The 5th term", "The 4th term", "The 6th term", "The 8th term"], "The 5th term", 2,
        "Solve 3(2)ⁿ⁻¹ = 48. Then 2ⁿ⁻¹ = 16 = 2⁴, so n - 1 = 4 and n = 5.",
        "In the sequence Tₙ = 5(3)ⁿ⁻¹, which term is equal to 135?",
        ["The 4th term", "The 3rd term", "The 5th term", "The 6th term"], "The 4th term"
    ),
    mcq(
        "Find the x-coordinates of the intersections of y = x² and y = 2x + 3.",
        ["x = -1 or x = 3", "x = 1 or x = -3", "x = 0 or x = 2", "x = -2 or x = 4"], "x = -1 or x = 3", 2,
        "Set the functions equal: x² = 2x + 3. Then x² - 2x - 3 = (x - 3)(x + 1) = 0.",
        "Find the x-coordinates of the intersections of y = x² and y = x + 6.",
        ["x = -2 or x = 3", "x = 2 or x = -3", "x = -1 or x = 6", "x = 1 or x = -6"], "x = -2 or x = 3"
    ),
    mcq(
        "On which interval is f(x) = x² - 4x increasing?",
        ["x > 2", "x < 2", "x > 4", "x < 4"], "x > 2", 2,
        "f′(x) = 2x - 4. The function is increasing where f′(x) > 0, which gives x > 2.",
        "On which interval is g(x) = -x² + 6x increasing?",
        ["x < 3", "x > 3", "x < 6", "x > 6"], "x < 3"
    ),
    mcq(
        "Events A and B are mutually exclusive. If P(A) = 0.35 and P(B) = 0.45, find P(A or B).",
        ["0.80", "0.1575", "0.10", "1.00"], "0.80", 2,
        "For mutually exclusive events, P(A or B) = P(A) + P(B) because P(A and B) = 0.",
        "Events C and D are mutually exclusive. If P(C) = 0.20 and P(D) = 0.30, find P(C or D).",
        ["0.50", "0.06", "0.10", "0.80"], "0.50"
    ),
    mcq(
        "Solve: log₂(x) = 5.",
        ["x = 32", "x = 10", "x = 25", "x = 7"], "x = 32", 2,
        "Rewrite in exponential form: x = 2⁵ = 32.",
        "Solve: log₃(x) = 4.",
        ["x = 81", "x = 12", "x = 64", "x = 7"], "x = 81"
    ),
    mcq(
        "Describe the turning point and nature of y = -2(x + 1)² + 3.",
        ["Maximum at (-1; 3)", "Minimum at (-1; 3)", "Maximum at (1; 3)", "Minimum at (1; -3)"], "Maximum at (-1; 3)", 2,
        "The turning point is (-1; 3). Because the coefficient of the squared term is negative, the parabola opens downward and the point is a maximum.",
        "Describe the turning point and nature of y = 0.5(x - 4)² - 2.",
        ["Minimum at (4; -2)", "Maximum at (4; -2)", "Minimum at (-4; -2)", "Maximum at (-4; 2)"], "Minimum at (4; -2)"
    ),
    mcq(
        "A rectangle has perimeter 40 m. What dimensions give the maximum area?",
        ["10 m by 10 m", "5 m by 15 m", "8 m by 12 m", "4 m by 16 m"], "10 m by 10 m", 2,
        "For a fixed perimeter, the rectangle with maximum area is a square. Each side is 40/4 = 10 m.",
        "A rectangle has perimeter 24 m. What dimensions give the maximum area?",
        ["6 m by 6 m", "4 m by 8 m", "3 m by 9 m", "2 m by 10 m"], "6 m by 6 m"
    ),
    mcq(
        "A vehicle worth R120 000 depreciates by 15% per year on the reducing-balance method. What is its value after 2 years?",
        ["R86 700", "R84 000", "R102 000", "R90 000"], "R86 700", 2,
        "Use A = P(1 - i)ⁿ: 120 000(0.85)² = R86 700.",
        "Equipment worth R80 000 depreciates by 10% per year on the reducing-balance method. What is its value after 3 years?",
        ["R58 320", "R56 000", "R72 000", "R64 800"], "R58 320"
    ),
    mcq(
        "Find the point of inflection of f(x) = x³ - 3x² + 2.",
        ["(1; 0)", "(-1; 0)", "(1; 2)", "(0; 2)"], "(1; 0)", 2,
        "f″(x) = 6x - 6. Set f″(x) = 0 to get x = 1, and f(1) = 0.",
        "Find the point of inflection of g(x) = x³ - 6x² + 9x.",
        ["(2; 2)", "(-2; 2)", "(2; -2)", "(1; 4)"], "(2; 2)"
    ),
    mcq(
        "Evaluate Σ(2k + 1) for k = 1 to 5.",
        ["35", "30", "25", "45"], "35", 3,
        "The terms are 3, 5, 7, 9 and 11. Their sum is 35.",
        "Evaluate Σ(3k - 1) for k = 1 to 4.",
        ["26", "24", "30", "20"], "26",
        {"title": "Level 3: Exam-style reasoning", "text": "Now combine formulas with interpretation. Check restrictions, classify stationary points, use correct financial timelines and justify probability relationships."}
    ),
    mcq(
        "If f(x) = 2ˣ, which statement describes its inverse?",
        ["f⁻¹(x) = log₂(x), with domain x > 0", "f⁻¹(x) = x/2, with domain all real x", "f⁻¹(x) = 2/x, with domain x ≠ 0", "f⁻¹(x) = logₓ(2), with domain x < 0"], "f⁻¹(x) = log₂(x), with domain x > 0", 3,
        "Interchanging x and y in y = 2ˣ gives x = 2ʸ, so y = log₂(x). A logarithm requires x > 0.",
        "If g(x) = 3ˣ, which statement describes its inverse?",
        ["g⁻¹(x) = log₃(x), with domain x > 0", "g⁻¹(x) = x/3, with domain all real x", "g⁻¹(x) = 3/x, with domain x ≠ 0", "g⁻¹(x) = logₓ(3), with domain x < 0"], "g⁻¹(x) = log₃(x), with domain x > 0"
    ),
    mcq(
        "For f(x) = x³ - 12x, classify the stationary points from left to right.",
        ["Local maximum at x = -2, then local minimum at x = 2", "Local minimum at x = -2, then local maximum at x = 2", "Two local maxima", "No stationary points"], "Local maximum at x = -2, then local minimum at x = 2", 3,
        "f′(x) = 3x² - 12 = 0 gives x = ±2. Since f″(x) = 6x, f″(-2) < 0 gives a maximum and f″(2) > 0 gives a minimum.",
        "For g(x) = x³ - 3x, classify the stationary points from left to right.",
        ["Local maximum at x = -1, then local minimum at x = 1", "Local minimum at x = -1, then local maximum at x = 1", "Two local minima", "No stationary points"], "Local maximum at x = -1, then local minimum at x = 1"
    ),
    mcq(
        "Using first principles, what derivative is obtained for f(x) = x²?",
        ["f′(x) = 2x", "f′(x) = x", "f′(x) = 2", "f′(x) = x²/2"], "f′(x) = 2x", 3,
        "Expand [(x + h)² - x²]/h to obtain (2xh + h²)/h = 2x + h. Taking h → 0 gives 2x.",
        "Using first principles, what derivative is obtained for g(x) = 3x²?",
        ["g′(x) = 6x", "g′(x) = 3x", "g′(x) = 6", "g′(x) = 3x²"], "g′(x) = 6x"
    ),
    mcq(
        "State the range restriction of y = 2/(x - 1) + 4.",
        ["y ≠ 4", "x ≠ 1", "y > 4", "y ≠ 1"], "y ≠ 4", 3,
        "The horizontal asymptote is y = 4, so the function cannot take the value y = 4.",
        "State the range restriction of y = -3/(x + 2) - 1.",
        ["y ≠ -1", "x ≠ -2", "y ≠ 2", "y > -1"], "y ≠ -1"
    ),
    mcq(
        "Solve simultaneously: y = x + 1 and x² + y² = 25.",
        ["(3; 4) and (-4; -3)", "(4; 3) and (-3; -4)", "(3; -4) and (-4; 3)", "(0; 5) and (0; -5)"], "(3; 4) and (-4; -3)", 3,
        "Substitute y = x + 1: x² + (x + 1)² = 25, giving x² + x - 12 = 0. Thus x = 3 or -4, with y = 4 or -3.",
        "Solve simultaneously: y = x - 1 and x² + y² = 25.",
        ["(4; 3) and (-3; -4)", "(3; 4) and (-4; -3)", "(4; -3) and (-3; 4)", "(5; 0) and (-5; 0)"], "(4; 3) and (-3; -4)"
    ),
    mcq(
        "The line y = k is tangent to y = x² - 4x + 3. Find k.",
        ["k = -1", "k = 1", "k = 3", "k = 4"], "k = -1", 3,
        "A horizontal tangent occurs at the turning point. Completing the square gives y = (x - 2)² - 1, so k = -1.",
        "The line y = k is tangent to y = x² + 2x + 5. Find k.",
        ["k = 4", "k = 5", "k = -4", "k = 1"], "k = 4"
    ),
    mcq(
        "A rectangle in the first quadrant has one corner at the origin and the opposite corner on y = 12 - x². What maximum area is possible?",
        ["16 square units", "12 square units", "24 square units", "8 square units"], "16 square units", 3,
        "Area A(x) = x(12 - x²). Then A′(x) = 12 - 3x² = 0 gives x = 2 and y = 8, so the maximum area is 16.",
        "A rectangle in the first quadrant has one corner at the origin and the opposite corner on y = 9 - x². What maximum area is possible?",
        ["6√3 square units", "9 square units", "3√3 square units", "18 square units"], "6√3 square units"
    ),
    mcq(
        "R1 000 is deposited at the end of every month into an account earning 1% per month. Approximately how much is accumulated immediately after the 12th deposit?",
        ["R12 682.50", "R12 000.00", "R13 809.33", "R11 255.08"], "R12 682.50", 3,
        "This is an ordinary annuity: F = 1 000[((1.01)¹² - 1)/0.01] ≈ R12 682.50.",
        "R500 is deposited at the end of every month into an account earning 2% per month. Approximately how much is accumulated immediately after the 6th deposit?",
        ["R3 154.06", "R3 000.00", "R3 217.14", "R2 801.43"], "R3 154.06"
    ),
    mcq(
        "Given P(A and B) = 0.18 and P(A) = 0.30, find P(B given A).",
        ["0.60", "0.54", "0.12", "0.48"], "0.60", 3,
        "Use conditional probability: P(B given A) = P(A and B)/P(A) = 0.18/0.30 = 0.60.",
        "Given P(C and D) = 0.12 and P(C) = 0.40, find P(D given C).",
        ["0.30", "0.48", "0.28", "0.52"], "0.30"
    ),
    mcq(
        "Find the sum to infinity of the geometric series 12 + 4 + 4/3 + ...",
        ["18", "16", "20", "12"], "18", 3,
        "Here a = 12 and r = 1/3. Since |r| < 1, S∞ = a/(1 - r) = 12/(2/3) = 18.",
        "Find the sum to infinity of the geometric series 20 - 4 + 0.8 - ...",
        ["50/3", "25", "16", "20"], "50/3",
        {"title": "Level 4: Paper 1 challenge zone", "text": "The final questions combine topics and require careful modelling. Identify the structure first, choose the correct formula or derivative, and test whether the answer makes sense in context."}
    ),
    mcq(
        "Let f(x) = 2x - 1 and g(x) = x² + 3. Determine f(g(x)).",
        ["2x² + 5", "4x² - 4x + 4", "x² + 2", "2x² + 2"], "2x² + 5", 3,
        "Substitute g(x) into f: f(g(x)) = 2(x² + 3) - 1 = 2x² + 5.",
        "Let f(x) = 2x - 1 and g(x) = x² + 3. Determine g(f(x)).",
        ["4x² - 4x + 4", "2x² + 5", "4x² + 4x + 4", "2x² + 2"], "4x² - 4x + 4"
    ),
    mcq(
        "Which statement correctly describes f(x) = x³ - 3x?",
        ["It increases for x < -1 and x > 1, and decreases for -1 < x < 1", "It decreases for x < -1 and x > 1", "It increases for all real x", "It has no turning points"], "It increases for x < -1 and x > 1, and decreases for -1 < x < 1", 3,
        "Since f′(x) = 3(x² - 1), the derivative is positive outside -1 and 1, and negative between them.",
        "Which statement correctly describes g(x) = x³ - 12x?",
        ["It increases for x < -2 and x > 2, and decreases for -2 < x < 2", "It decreases for x < -2 and x > 2", "It increases only for -2 < x < 2", "It has no stationary points"], "It increases for x < -2 and x > 2, and decreases for -2 < x < 2"
    ),
    mcq(
        "A particle's displacement is s(t) = t³ - 6t² + 9t metres. What is its velocity at t = 2 seconds?",
        ["-3 m/s", "3 m/s", "0 m/s", "5 m/s"], "-3 m/s", 3,
        "Velocity is v(t) = s′(t) = 3t² - 12t + 9. Thus v(2) = 12 - 24 + 9 = -3 m/s.",
        "A particle's displacement is s(t) = t³ - 3t² + 2t metres. What is its velocity at t = 1 second?",
        ["-1 m/s", "1 m/s", "0 m/s", "2 m/s"], "-1 m/s"
    ),
    mcq(
        "A company sells x items at a price of R(200 - 2x) each. Its cost is C(x) = 20x + 1 000. How many items maximise profit?",
        ["45 items", "40 items", "50 items", "90 items"], "45 items", 3,
        "Revenue is R(x) = x(200 - 2x). Profit is P(x) = -2x² + 180x - 1 000, whose turning point occurs at x = -180/[2(-2)] = 45.",
        "A company sells x items at a price of R(150 - x) each. Its cost is C(x) = 30x + 900. How many items maximise profit?",
        ["60 items", "30 items", "75 items", "120 items"], "60 items"
    ),
]


data = {
    "title": "Fun Quiz: Grade 12 Mathematics Paper 1 Challenge",
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
