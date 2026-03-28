import { createSeededRng } from "@/components/personas/rng";
import { weightedSample } from "@/components/personas/ipf";

export type CensusMarginals = {
  ageGroups: Record<string, number>;
  gender: Record<string, number>;
  tenure: Record<string, number>;
  employment: Record<string, number>;
};

export type SyntheticPersona = {
  age_group: string;
  gender: string;
  housing_tenure: string;
  employment_status: string;
  sampling_probability: number;
};

export function generatePersonasForConstituency(marginals: CensusMarginals, count: number, seed: number): SyntheticPersona[] {
  const random = createSeededRng(seed);
  const ages = Object.keys(marginals.ageGroups);
  const genders = Object.keys(marginals.gender);
  const tenures = Object.keys(marginals.tenure);
  const employmentStatuses = Object.keys(marginals.employment);

  const personas: SyntheticPersona[] = [];
  for (let index = 0; index < count; index += 1) {
    const age = weightedSample(ages, Object.values(marginals.ageGroups), random);
    const gender = weightedSample(genders, Object.values(marginals.gender), random);
    const tenure = weightedSample(tenures, Object.values(marginals.tenure), random);
    const employment = weightedSample(employmentStatuses, Object.values(marginals.employment), random);
    personas.push({
      age_group: age,
      gender,
      housing_tenure: tenure,
      employment_status: employment,
      sampling_probability: 1 / count,
    });
  }
  return personas;
}
