export function compactContainerEnv(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      return String(value).trim().toLowerCase() !== 'undefined';
    }),
  );
}
