const { seedAll } = require('./seed_lib');

const result = seedAll(null);
console.log('Seeded DRO local store from data/office_map.json:', result);
