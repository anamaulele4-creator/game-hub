export function ageFrom(birth: string): number {
  const b = new Date(birth);
  if (isNaN(b.getTime())) return 0;
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--;
  return a;
}
