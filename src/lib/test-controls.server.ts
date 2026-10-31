export type TestControls = { now: Date; failAfter: number | null };

export function testControls(req: Request): TestControls {
  if (process.env.AI_MOCK !== '1') return { now: new Date(), failAfter: null };

  const nowHeader = req.headers.get('x-test-now');
  const parsedNow = nowHeader ? new Date(nowHeader) : null;
  const now = parsedNow && !Number.isNaN(parsedNow.getTime()) ? parsedNow : new Date();

  const failHeader = req.headers.get('x-test-fail-after');
  const parsedFail = failHeader === null ? NaN : Number(failHeader);
  const failAfter = Number.isInteger(parsedFail) && parsedFail >= 0 ? parsedFail : null;

  return { now, failAfter };
}
