"""Arounus-owned subject codes. These are not university course identifiers."""

SUBJECT_CATALOG = []
LEGACY_SUBJECT_NAMES = {}

for short, title, grades in (
    ("NS", "Natural Sciences", (8, 9)),
    ("PS", "Physical Sciences", (10, 11, 12)),
    ("LS", "Life Sciences", (10, 11, 12)),
    ("AS", "Agricultural Sciences", (10, 11, 12)),
    ("TS", "Technical Sciences", (10, 11, 12)),
    ("GE", "Geography", (8, 9, 10, 11, 12)),
):
    for grade in grades:
        SUBJECT_CATALOG.append({
            "module_code": f"ARU-HS-{short}{grade:02d}",
            "module_name": f"{title} — Grade {grade} (ARU-HS-{short}{grade:02d})",
            "group": "High school · Grades 8–9" if grade < 10 else "High school · Grades 10–12",
        })

for group, subjects in (
    ("University · Molecular and Life Sciences", (
        ("BCH", "Biochemistry"), ("BTN", "Biotechnology"), ("BOT", "Botany"),
        ("MIC", "Microbiology"), ("PHL", "Physiology"), ("ZOO", "Zoology"),
        ("GEN", "Genetics"), ("MOL", "Molecular Biology"),
    )),
    ("University · Physical and Mineral Sciences", (
        ("CHE", "Chemistry"), ("PHY", "Physics"), ("GEM", "Geology and Mining"),
    )),
    ("University · Mathematical and Computer Sciences", (
        ("COS", "Computer Science"), ("MAT", "Mathematics"),
        ("AMA", "Applied Mathematics"), ("STA", "Statistics"),
        ("OPR", "Operations Research"),
    )),
):
    prefix = {"University · Molecular and Life Sciences": "ML", "University · Physical and Mineral Sciences": "PM", "University · Mathematical and Computer Sciences": "MC"}[group]
    for short, title in subjects:
        old_code = f"ARU-{prefix}-{short}"
        LEGACY_SUBJECT_NAMES[old_code] = f"{title} ({old_code})"
        for level_code, level_label, name in (
            ("Y1", "1st year", f"Fundamentals of {title}"),
            ("Y2", "2nd year", f"Introduction to {title}"),
            ("Y3", "3rd year", f"Applications of {title}"),
            ("FY", "Final year", f"Advanced {title}"),
            ("H1", "Honours", f"{title} Research"),
        ):
            code = f"ARU-{prefix}-{short}-{level_code}"
            SUBJECT_CATALOG.append({
                "module_code": code,
                "module_name": f"{name} — {level_label} ({code})",
                "group": f"{group} · {level_label}",
                "subject": title,
                "level": level_label,
            })

SUBJECT_NAMES = {item["module_code"]: item["module_name"] for item in SUBJECT_CATALOG}
