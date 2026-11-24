import { expect, test, type Page } from '@playwright/test';

async function fillGroup(page: Page, name: string, size: number, email: string) {
  await page.getByLabel('Group or project name').fill(name);
  await page.getByLabel('Number of students').selectOption(String(size));
  for (let i = 1; i <= size; i++) await page.getByLabel(`Student ${i} full name`).fill(`${name} Member ${i}`);
  await page.getByLabel("Representative's email").fill(email);
}

test.describe.serial('student and lecturer workflows', () => {
  let manageUrl = '';

  test('student registers a group and gets an automatically assigned time', async ({ page }) => {
    await page.goto('/booking');
    await expect(page.getByRole('heading', { name: 'Tuesday, 15 December 2026' })).toBeVisible();
    await page
      .getByRole('link', { name: /Register my group for this date/ })
      .first()
      .click();

    // Validation: empty form
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(page.getByText('Please enter a group or project name')).toBeVisible();

    await fillGroup(page, 'Graph Miners', 4, 'rep@example.org');
    await expect(page.getByText('Total examination duration: 60 minutes')).toBeVisible();
    await page.getByLabel('Number of students').selectOption('5');
    await expect(page.getByText('Total examination duration: 70 minutes')).toBeVisible();
    await page.getByLabel('Student 5 full name').fill('Graph Miners Member 5');

    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(page.getByText('09:00–10:10')).toBeVisible();
    await expect(page.getByText('you cannot choose a time')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm booking' })).toBeDisabled();
    await page.getByRole('checkbox', { name: /I have read the box above/ }).check();
    await page.getByRole('button', { name: 'Confirm booking' }).click();

    await expect(page.getByText('Your group is registered')).toBeVisible();
    manageUrl = await page.getByLabel('Booking management link').inputValue();
    expect(manageUrl).toMatch(/\/manage#t=[A-Za-z0-9_-]{40,}/);
    await expect(page.getByText('No confirmation email could be sent')).toBeVisible();
  });

  test('public schedule shows the group but no private data', async ({ page }) => {
    await page.goto('/booking');
    await page.getByRole('link', { name: 'See the timetable of this day' }).first().click();
    await expect(page.getByText('Graph Miners').first()).toBeVisible();
    await expect(page.getByText('Lunch break').first()).toBeVisible();
    await expect(page.getByText('This schedule is tentative')).toBeVisible();
    await expect(page.getByText('rep@example.org')).toHaveCount(0);
  });

  test('representative manages the booking via the secure link', async ({ page }) => {
    await page.goto(manageUrl.replace('http://localhost:5174', ''));
    await expect(page.getByRole('heading', { name: 'Graph Miners' })).toBeVisible();
    await expect(page).not.toHaveURL(/#t=/); // token removed from the address bar
    await page.getByRole('button', { name: 'Modify booking' }).click();
    await page.getByLabel('Number of students').selectOption('3');
    await page.getByRole('button', { name: 'Check new time' }).click();
    await expect(page.getByText('estimated 09:00–09:50')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm changes' }).click();
    await expect(page.getByText('Your booking has been updated.')).toBeVisible();
    await expect(page.getByText('09:00–09:50')).toBeVisible();
  });

  test('invalid links are rejected clearly', async ({ page }) => {
    await page.goto('/manage#t=' + 'A'.repeat(43));
    await expect(page.getByText('This booking link is invalid or has expired')).toBeVisible();
  });

  test('lecturer signs in, inspects the timeline, previews and finalizes', async ({ page }) => {
    await page.goto('/admin');
    await page.getByLabel('Email').fill('lecturer@example.org');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    await page.getByLabel('Password').fill('e2e-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Lecturer dashboard')).toBeVisible();
    await page.getByRole('link', { name: /Tuesday, 15 December 2026/ }).click();
    await expect(page.getByRole('cell', { name: /^Graph Miners#/ })).toBeVisible();

    await page.getByRole('button', { name: 'Finalize schedule' }).click();
    await expect(page.getByText('Preview: Finalize schedule')).toBeVisible();
    await page.getByRole('button', { name: 'Finalize and notify groups' }).click();
    await expect(page.getByText('Schedule finalized.')).toBeVisible();
    await expect(page.getByText('Finalized · times confirmed').first()).toBeVisible();

    await page.goto(manageUrl.replace('http://localhost:5174', ''));
    await expect(page.getByText('Confirmed time')).toBeVisible();
  });

  test('website pages render from Markdown content', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Distributed Data Analysis and Mining' })).toBeVisible();
    await page.getByRole('link', { name: 'News', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Course website online' })).toBeVisible();
    await page.getByRole('link', { name: 'Past projects', exact: true }).click();
    await expect(page.getByText('No projects have been published yet.')).toBeVisible();
    await page.getByRole('link', { name: 'Materials', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Lectures' })).toBeVisible();
    await page.getByRole('link', { name: 'Exam booking', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tuesday, 15 December 2026' })).toBeVisible();
  });

  test('@mobile booking page is usable on a phone', async ({ page }) => {
    await page.goto('/booking');
    await expect(page.getByRole('heading', { name: 'Friday, 18 December 2026' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Register my group for this date/ }).first()).toBeVisible();
  });
});
