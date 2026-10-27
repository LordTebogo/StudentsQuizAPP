(function () {
  const names = Object.freeze({
    SBIA021: 'Introduction to Biochemistry',
    SBIA022: 'Biochemistry II',
    SBIA031: 'Biochemistry III',
    SMIB032: 'Molecular Biology',
    SBTB031: 'Biotechnology I',
    SBTA032: 'Immunology I',
    ADVANCED_BIOLOGY: 'Advanced Biology',
    ADVANCED_IMMUNOLOGY: 'Advanced Immunology',
    ADVANCED_INDUSTRIAL_BIOTECHNOLOGY: 'Advanced Industrial Biotechnology',
    ENVIRONMENTAL_BIOTECHNOLOGY: 'Environmental Biotechnology',
    BIOLOGICAL_PRODUCTS_AND_PROCESSES: 'Biological Products and Processes',
  });

  window.moduleNames = names;
  window.moduleName = code => names[code] || code || '';
  window.moduleLabel = code => names[code] ? `${names[code]} (${code})` : code || '';
})();
