import { z } from "zod";

export const DECADES = ["70s", "80s", "90s", "2000s", "2010s", "2020s"] as const;

export type Decade = (typeof DECADES)[number];

export const decadeSchema = z.enum(DECADES);

export interface Quote {
  quote: string;
  movie: string;
  year: number;
  decade: Decade;
}

export function isDecade(value: string): value is Decade {
  return (DECADES as readonly string[]).includes(value);
}
