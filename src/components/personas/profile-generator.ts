import { createSeededRng } from "@/components/personas/rng";
import { generateName } from "@/components/personas/name-generator";
import type { SyntheticPersona } from "@/components/personas/persona-sampler";

const occupations = ["Teacher", "Nurse", "Logistics coordinator", "Retail manager", "Software engineer", "Civil servant"];

export type SyntheticProfile = {
  name: string;
  persona: SyntheticPersona;
  occupation: string;
  narrative: string;
};

export function generateProfile(persona: SyntheticPersona, seed: number): SyntheticProfile {
  const random = createSeededRng(seed);
  const occupation = occupations[Math.floor(random() * occupations.length)] ?? occupations[0];
  const name = generateName(random);
  return {
    name,
    persona,
    occupation,
    narrative: `${name} is a ${persona.age_group} resident working as a ${occupation}.`,
  };
}
