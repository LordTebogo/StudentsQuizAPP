(function () {
  const names = Object.freeze({
    SBIA011: 'Biochemistry Foundations',
    SBIA021: 'Introduction to Biochemistry',
    SBIA022: 'Biochemistry',
    SBIA031: 'Advanced Biochemistry',
    SMIB032: 'Molecular Biology',
    SBTB031: 'Biotechnology',
    SBTA032: 'Immunology',
    CHEMISTRY: 'Chemistry',
    PHYSICS: 'Physics',
    MATH: 'Mathematics',
    GENERAL: 'General Studies',
    AROUNUS: 'How to Use Arounus',
    ADVANCED_BIOLOGY: 'Advanced Biology',
    ADVANCED_IMMUNOLOGY: 'Advanced Immunology',
    ADVANCED_INDUSTRIAL_BIOTECHNOLOGY: 'Advanced Industrial Biotechnology',
    ENVIRONMENTAL_BIOTECHNOLOGY: 'Environmental Biotechnology',
    BIOLOGICAL_PRODUCTS_AND_PROCESSES: 'Biological Products and Processes',
  });

  window.moduleNames = names;
  window.moduleName = code => names[code] || code || '';
  window.moduleLabel = code => names[code] || code || '';
  window.moduleDisplayTitle = (title, code) => String(title || '').replace(/\b(?:SBIA|SMIB|SBTB|SBTA)\d{3}\b\s*[-–—:]?\s*/gi, '').trim() || window.moduleLabel(code);
  window.moduleSlug = code => window.moduleLabel(code).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  window.moduleCodeFromSlug = value => Object.keys(names).find(code => window.moduleSlug(code) === value) || value;
})();
