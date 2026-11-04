import { expect, test } from '@playwright/test';
import { OWNER } from '../helpers/users';

test('visiting / without a session lands on the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('logging in through the form lands on the library', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // the first visit compiles the library page in the dev server
  await expect(page).toHaveURL(/\/library$/, { timeout: 60_000 });
});
