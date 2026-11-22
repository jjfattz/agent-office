import { streetBelow } from '../../../shared/layout';
import type { Interactable } from '../../world/types';
import type { Fixture, StreetSite } from '../../world/office/fixture';
import { buildCourse } from './course';
import { buildTees } from './tees';

// The golf course across the street, as a fixture of the office floor: built down on the street with
// everything else there (see StreetSite), so it's further down the higher your floor is.

export interface CourseView {
  /** Each hole's tee, by hole: E there tees off. */
  tees: Interactable[];
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The golf course across the street (see course.ts and tees.ts). */
    course: CourseView;
  }
}

/** The three holes across the street, their tees and the way in. */
export const course: Fixture<'course', StreetSite> = (site) => {
  const built = buildCourse(site.ground, site.groundColliders, site.get('night'));
  const tees = buildTees(site.ground, site.groundColliders);
  site.interactables.push(...tees);
  return {
    handle: { course: { tees } },
    update: (t) => built.update(t),
    setLevel: (index) => {
      for (const it of tees) it.y = streetBelow(index);
    },
  };
};
