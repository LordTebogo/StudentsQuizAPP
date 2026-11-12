(function () {
  const names = {
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
  };
  const catalog = [];
  for (const [short, title, grades] of [
    ['NS','Natural Sciences',[8,9]], ['PS','Physical Sciences',[10,11,12]],
    ['LS','Life Sciences',[10,11,12]], ['AS','Agricultural Sciences',[10,11,12]],
    ['TS','Technical Sciences',[10,11,12]], ['GE','Geography',[8,9,10,11,12]],
  ]) for (const grade of grades) {
    const code = `ARU-HS-${short}${String(grade).padStart(2,'0')}`;
    catalog.push({module_code:code,module_name:`${title} — Grade ${grade} (${code})`,group:grade<10?'High school · Grades 8–9':'High school · Grades 10–12'});
  }
  for (const [prefix, group, subjects] of [
    ['ML','University · Molecular and Life Sciences', [['BCH','Biochemistry'],['BTN','Biotechnology'],['BOT','Botany'],['MIC','Microbiology'],['PHL','Physiology'],['ZOO','Zoology'],['GEN','Genetics'],['MOL','Molecular Biology']]],
    ['PM','University · Physical and Mineral Sciences', [['CHE','Chemistry'],['PHY','Physics'],['GEM','Geology and Mining']]],
    ['MC','University · Mathematical and Computer Sciences', [['COS','Computer Science'],['MAT','Mathematics'],['AMA','Applied Mathematics'],['STA','Statistics'],['OPR','Operations Research']]],
  ]) for (const [short,title] of subjects) {
    const oldCode = `ARU-${prefix}-${short}`;
    names[oldCode] = `${title} (${oldCode})`;
    for (const [levelCode,levelLabel,name] of [
      ['Y1','1st year',`Fundamentals of ${title}`],
      ['Y2','2nd year',`Introduction to ${title}`],
      ['Y3','3rd year',`Applications of ${title}`],
      ['FY','Final year',`Advanced ${title}`],
      ['H1','Honours',`${title} Research`],
    ]) {
      const code = `ARU-${prefix}-${short}-${levelCode}`;
      catalog.push({module_code:code,module_name:`${name} — ${levelLabel} (${code})`,group:`${group} · ${levelLabel}`,subject:title,level:levelLabel});
    }
  }
  catalog.forEach(item => { names[item.module_code] = item.module_name; });
  Object.freeze(names);
  window.moduleCatalog = Object.freeze(catalog);

  window.moduleNames = names;
  window.moduleName = code => names[code] || code || '';
  window.moduleLabel = code => names[code] || code || '';
  window.moduleDisplayTitle = (title, code) => String(title || '').replace(/\b(?:SBIA|SMIB|SBTB|SBTA)\d{3}\b\s*[-–—:]?\s*/gi, '').trim() || window.moduleLabel(code);
  window.moduleSlug = code => window.moduleLabel(code).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  window.moduleCodeFromSlug = value => Object.keys(names).find(code => window.moduleSlug(code) === value) || value;
})();
