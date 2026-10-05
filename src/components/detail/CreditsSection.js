'use client';

import { useState } from 'react';
import site from '@config/site';
import Carousel from '@/components/ui/Carousel';
import PersonCard from '@/components/media/PersonCard';

/**
 * Cast and crew for a title. The screenshots show this as a scrollable row of
 * person cards with a Cast/Crew toggle.
 */
export default function CreditsSection({ cast = [], crew = [] }) {
  const [tab, setTab] = useState('cast');

  if (!site.detail.showCredits) return null;
  if (cast.length === 0 && crew.length === 0) return null;

  const people = tab === 'cast' ? cast : crew;

  return (
    <Carousel
      title="Credits"
      action={
        <div
          role="tablist"
          className="flex items-center gap-1 rounded-[var(--radius-pill)] border
            border-line bg-card p-1"
        >
          {[
            { id: 'cast', label: 'Cast' },
            { id: 'crew', label: 'Crew' },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={tab === option.id}
              onClick={() => setTab(option.id)}
              className={`rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium
                transition-colors
                ${tab === option.id ? 'bg-accent text-accent-text' : 'text-muted hover:text-text'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      }
      className="mt-10"
    >
      {people.map((person) => (
        <div key={`${person.id}-${person.credit_id ?? person.job}`} className="snap-item w-56 shrink-0">
          <PersonCard person={person} />
        </div>
      ))}
    </Carousel>
  );
}
