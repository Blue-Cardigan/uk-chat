import { weightedSample } from "@/components/personas/ipf";

const firstNames = ["Alex", "Sam", "Priya", "Morgan", "Jamie", "Amina", "Jordan", "Taylor"];
const lastNames = ["Patel", "Smith", "Khan", "Jones", "Ali", "Brown", "Evans", "Clark"];

export function generateName(random: () => number) {
  const first = weightedSample(firstNames, firstNames.map(() => 1), random);
  const last = weightedSample(lastNames, lastNames.map(() => 1), random);
  return `${first} ${last}`;
}
