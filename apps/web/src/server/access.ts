export function hasDemoAccess(request: Request) {
  const expected = process.env.PACTA_DEMO_ACCESS_KEY;
  return Boolean(
    expected && request.headers.get("x-pacta-demo-key") === expected,
  );
}
