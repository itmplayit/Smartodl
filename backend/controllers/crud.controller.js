'use strict';
/** Thin CRUD controllers for simple resources (column whitelists prevent injection). */
const { makeCrud } = require('../utils/crud');

const categories = makeCrud({
  table: 'categories',
  fields: { name: 'string', slug: 'string', type: 'string', description: 'string', icon: 'string' },
  orderBy: 'type ASC, name ASC',
  searchable: ['name'],
  slugFrom: 'name',
});

const lessons = makeCrud({
  table: 'lessons',
  fields: {
    module_id: 'number', course_id: 'number', title: 'string', description: 'string', video_url: 'string',
    content: 'string', resource_url: 'string', duration_minutes: 'number', position: 'number', is_preview: 'number',
  },
  orderBy: 'position ASC, id ASC',
  searchable: ['title'],
});

const modules = makeCrud({
  table: 'course_modules',
  fields: { course_id: 'number', title: 'string', description: 'string', position: 'number' },
  orderBy: 'position ASC, id ASC',
  searchable: ['title'],
});

module.exports = { categories, lessons, modules };
