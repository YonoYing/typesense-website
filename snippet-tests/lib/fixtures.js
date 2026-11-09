'use strict'

// Datasets the docs use again and again. Tests can use these instead of
// repeating schemas in every beforeAll().

const companies = {
  schema: {
    name: 'companies',
    fields: [
      { name: 'company_name', type: 'string' },
      { name: 'num_employees', type: 'int32' },
      { name: 'country', type: 'string', facet: true },
    ],
    default_sorting_field: 'num_employees',
  },
  documents: [
    { id: '124', company_name: 'Stark Industries', num_employees: 5215, country: 'USA' },
    { id: '125', company_name: 'Future Technology', num_employees: 1232, country: 'UK' },
    { id: '126', company_name: 'Random Corp.', num_employees: 531, country: 'AU' },
  ],
}

// A schema that accepts any document, for collections whose shape the docs
// never spell out.
function autoSchema(name) {
  return { name, fields: [{ name: '.*', type: 'auto' }] }
}

module.exports = { companies, autoSchema }
