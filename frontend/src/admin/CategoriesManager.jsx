import { useEffect, useState } from 'react';
import Crud from '../components/Crud';
import { miscApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

const TYPES = ['course', 'coding', 'quiz', 'notes', 'contest', 'all'];

export default function CategoriesManager({ scope = 'admin' }) {
  const { can, hasRole } = useAuth();
  const [cats, setCats] = useState([]);
  useEffect(() => { miscApi.categories().then(({ data }) => setCats(data.data)).catch(() => {}); }, []);

  return (
    <Crud
      eyebrow="Taxonomy"
      title="Course & content categories"
      subtitle="Categories power the filters on courses, notes, quizzes and the coding arena."
      list={miscApi.categories}
      create={miscApi.createCategory}
      update={miscApi.updateCategory}
      remove={hasRole('admin') ? miscApi.removeCategory : undefined}
      canWrite={scope === 'admin' || can('create_course')}
      defaults={{ name: '', type: 'course', description: '', icon: '' }}
      filters={[{ name: 'type', label: 'Type', options: TYPES }]}
      columns={[
        { key: 'id', label: '#', className: 'small' },
        { key: 'icon', label: '', render: (r) => <span style={{ fontSize: '1.2rem' }}>{r.icon || '🏷'}</span> },
        { key: 'name', label: 'Name', render: (r) => <strong>{r.name}</strong> },
        { key: 'slug', label: 'Slug', className: 'small' },
        { key: 'type', label: 'Type', render: (r) => <span className="tag">{r.type}</span> },
        { key: 'description', label: 'Description', className: 'small' },
        { key: 'created_at', label: 'Created', render: (r) => <span className="tiny muted">{new Date(r.created_at).toLocaleDateString()}</span> },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true, placeholder: 'Web Development' },
        { name: 'type', label: 'Type', type: 'select', options: TYPES.map((t) => ({ value: t, label: t })), required: true },
        { name: 'icon', label: 'Icon (emoji)', placeholder: '💻' },
        { name: 'description', label: 'Description', type: 'textarea', full: true },
      ]}
      emptyHint={`No categories yet — ${cats.length} total rows returned from the API.`}
    />
  );
}
