'use client';

import { useState } from 'react';
import type { WeekStory } from '@/lib/week-story';
import { formatWeekLabel } from '@/lib/week-story';

interface Props {
  story: WeekStory | null;
}

export function HeroSection({ story }: Props) {
  const [showExplain, setShowExplain] = useState(false);

  if (!story) return null;

  return (
    <section className="mb-12 print:mb-6 print:text-black">
      <p className="text-sm text-muted uppercase tracking-wide mb-3 print:text-gray-600">
        {formatWeekLabel(story.weekStart, story.weekEnd)}
      </p>

      <h1 className="text-2xl sm:text-4xl font-semibold leading-snug sm:leading-snug max-w-3xl print:text-black">
        {story.headline}
      </h1>

      {story.lines.length > 0 && (
        <div className="mt-4 space-y-2 max-w-2xl">
          {story.lines.map((line, i) => (
            <p key={i} className="text-base sm:text-lg text-secondary leading-relaxed print:text-gray-800">
              {line}
            </p>
          ))}
        </div>
      )}

      {story.action && (
        <p className="mt-6 inline-block rounded-lg border-l-4 border-accent bg-overlay/5 px-4 py-3 text-base font-medium max-w-2xl print:border-black print:bg-white print:text-black">
          {story.action}
        </p>
      )}

      {story.tiles.length > 0 && (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl">
          {story.tiles.map((tile) => (
            <div key={tile.label} className="card p-5 print:shadow-none print:border print:border-gray-400">
              <p className="text-sm text-secondary print:text-gray-700">{tile.label}</p>
              <p className="text-2xl sm:text-3xl font-bold font-mono mt-1 text-gradient print:text-black">
                {tile.value}
              </p>
              <p className="text-xs text-muted mt-1 print:text-gray-600">{tile.sub}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 print:hidden">
        <button
          type="button"
          onClick={() => setShowExplain((v) => !v)}
          className="text-xs text-muted hover:text-secondary underline underline-offset-2"
        >
          how these numbers are figured
        </button>
        {showExplain && (
          <ul className="mt-2 space-y-1 text-xs text-muted max-w-xl list-disc pl-4">
            {story.explain.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
