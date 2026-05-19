'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { ProxyCheckError } = require('./services/adspower');
const { randomName } = require('./services/names');

/**
 * Главный оркестратор одного цикла регистрации.
 *
 * @param {object} params
 * @param {object} params.db           — объект базы данных (createSQLiteDatabase)
 * @param {object} params.config       — объект конфигурации (src/config.js)
 * @param {object} params.logger       — winston-совместимый логгер
 * @param {object} params.adsPower     — AdsPowerService (createAdsPowerService)
 * @param {object} params.emailService — EmailService (createEmailService)
 * @param {object} params.captchaService — CaptchaService (createCaptchaService)
 * @param {object} params.cookiesService — CookiesService (createCookiesService)
 * @param {{ stopped: boolean }} params.stopSignal — флаг graceful shutdown
 * @returns {Promise<{ status: string, email?: string, step?: string, error?: string }>}
 */
async function runWorker({ db, config, logger, adsPower, emailService, captchaService, cookiesService, stopSignal }) {
  let currentStep = 'STEP_1';
  let emailRecord = null;
  let proxyRecord = null;
  let profileId = null;
  let browser = null;
  let context = null;
  let page = null;

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Взять email из БД
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_1';
    emailRecord = db.claimEmail(config.maxRetries);
    if (!emailRecord) {
      logger.info('[Worker] No available emails in queue. Stopping.');
      return { status: 'no_emails' };
    }
    logger.info(`[Worker] [STEP_1] Claimed email: ${emailRecord.email}`);

    if (stopSignal.stopped) return { status: 'stopped' };

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Взять прокси из БД
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_2';
    proxyRecord = db.claimProxy();
    if (!proxyRecord) {
      db.releaseEmail(emailRecord.id, 'available');
      logger.warn('[Worker] [STEP_2] No available proxies. Email returned to queue.');
      return { status: 'no_proxies' };
    }
    logger.info(`[Worker] [STEP_2] Claimed proxy: ${proxyRecord.host}:${proxyRecord.port}`);

    if (stopSignal.stopped) {
      db.releaseEmail(emailRecord.id, 'available');
      db.releaseProxy(proxyRecord.id, 'available');
      return { status: 'stopped' };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Создать профиль AdsPower и сохранить в БД
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_3';
    profileId = await adsPower.createProfile(proxyRecord, config.adspowerGroupId, emailRecord.email);
    db.saveAdsPowerProfile({
      profile_id: profileId,
      email_id: emailRecord.id,
      proxy_id: proxyRecord.id,
      group_id: config.adspowerGroupId,
    });
    logger.info(`[Worker] [STEP_3] AdsPower profile created: ${profileId}`);

    if (stopSignal.stopped) return { status: 'stopped' };

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Запустить профиль, получить CDP endpoint
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_4';
    const cdpEndpoint = await adsPower.startProfile(profileId, config.headless);
    logger.info(`[Worker] [STEP_4] AdsPower profile started, CDP: ${cdpEndpoint}`);

    if (stopSignal.stopped) return { status: 'stopped' };

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: Подключить Playwright через CDP
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_5';
    browser = await chromium.connectOverCDP(cdpEndpoint);
    context = browser.contexts()[0] || await browser.newContext();

    // Закрываем все лишние вкладки — оставляем только одну рабочую
    const existingPages = context.pages();
    page = existingPages[0] || await context.newPage();
    // Закрываем все остальные вкладки
    for (let i = 1; i < existingPages.length; i++) {
      await existingPages[i].close().catch(() => {});
    }

    logger.info('[Worker] [STEP_5] Playwright connected via CDP');

    if (stopSignal.stopped) return { status: 'stopped' };

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: Блокировать медиа-ресурсы для ускорения загрузки
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_6';
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    logger.info('[Worker] [STEP_6] Media resources blocked');

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 7: Открыть страницу регистрации
    // app.lumalabs.ai/auth/sign-up сразу открывает форму регистрации
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_7';
    await page.goto(config.targetUrl, {
      timeout: config.playwrightTimeoutMs,
      waitUntil: 'networkidle',
    });
    logger.info(`[Worker] [STEP_7] Navigated to ${config.targetUrl}`);
    await page.waitForTimeout(1500);

    if (stopSignal.stopped) return { status: 'stopped' };

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 8: Заполнить форму — First name, Last name, Email
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_8';

    const { firstName, lastName } = randomName();
    logger.info(`[Worker] [STEP_8] Using name: ${firstName} ${lastName}`);

    // Ждём поля first_name
    await page.waitForSelector('input[name="first_name"]', {
      timeout: config.playwrightTimeoutMs,
    });
    await page.waitForTimeout(500);

    // First name
    await page.click('input[name="first_name"]');
    await page.waitForTimeout(200);
    await page.type('input[name="first_name"]', firstName, { delay: 80 });
    await page.waitForTimeout(300);

    // Last name
    await page.click('input[name="last_name"]');
    await page.waitForTimeout(200);
    await page.type('input[name="last_name"]', lastName, { delay: 80 });
    await page.waitForTimeout(300);

    // Email
    await page.click('input[name="email"]');
    await page.waitForTimeout(200);
    await page.type('input[name="email"]', emailRecord.email, { delay: 60 });
    await page.waitForTimeout(500);

    logger.info(`[Worker] [STEP_8] Form filled: ${firstName} ${lastName} / ${emailRecord.email}`);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 9: Нажать Continue (основная кнопка формы)
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_9';
    await page.waitForSelector('button:has-text("Continue")', {
      timeout: config.playwrightTimeoutMs,
    });
    await page.waitForTimeout(400);
    await page.click('button:has-text("Continue")');
    logger.info('[Worker] [STEP_9] Clicked Continue button');

    // Ждём следующую страницу (пароль + "Continue with email code")
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Проверяем ошибку "This email is not available"
    const emailError = await page.$('text="This email is not available"');
    if (emailError) {
      throw new Error('EMAIL_NOT_AVAILABLE: This email is not available on Luma (already registered or invalid)');
    }

    if (stopSignal.stopped) return { status: 'stopped' };

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 10: Нажать "Continue with email code" на странице пароля
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_10';

    await page.waitForSelector('a:has-text("Continue with email code"), .ak-AuthButton', {
      timeout: config.playwrightTimeoutMs,
    });
    await page.waitForTimeout(400);

    // Перехватываем возможную новую вкладку
    const [newPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 3000 }).catch(() => null),
      page.click('a:has-text("Continue with email code"), .ak-AuthButton'),
    ]);

    if (newPage) {
      await newPage.waitForLoadState('domcontentloaded');
      page = newPage;
      logger.info('[Worker] [STEP_10] Switched to new tab');
    }

    logger.info('[Worker] [STEP_10] Clicked "Continue with email code"');
    await page.waitForTimeout(1000);

    // Проверяем ошибку "This email is not available" после клика email code
    const emailErrorAfterCode = await page.$('text="This email is not available"');
    if (emailErrorAfterCode) {
      throw new Error('EMAIL_NOT_AVAILABLE: This email is not available on Luma (already registered or invalid)');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 11: Получить код подтверждения из email
    // Ищем только письма от lumalabs.ai, пришедшие после нажатия кнопки
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_11';
    const codeRequestTime = Date.now() - 5 * 60 * 1000; // ищем письма за последние 5 минут
    const confirmationCode = await emailService.waitForConfirmationCode(
      emailRecord.email,
      emailRecord.password,
      config.emailTimeoutMs,
      codeRequestTime
    );
    logger.info(`[Worker] [STEP_11] Confirmation code received: ${confirmationCode}`);

    if (stopSignal.stopped) return { status: 'stopped' };

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 12: Ввести 6-значный OTP код в Luma (6 отдельных инпутов)
    // Страница: auth.lumalabs.ai/magic-code
    // Селектор: input.rt-reset.rt-TextFieldInput[maxlength="1"]
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_12';

    // Ждём перехода на страницу magic-code
    await page.waitForURL('**/magic-code**', { timeout: config.playwrightTimeoutMs });
    logger.info('[Worker] [STEP_12] On magic-code page');

    // Ждём появления первого OTP инпута
    await page.waitForSelector('input.rt-reset.rt-TextFieldInput[maxlength="1"]', {
      timeout: config.playwrightTimeoutMs,
    });

    // Получаем все 6 инпутов
    const otpInputs = await page.$$('input.rt-reset.rt-TextFieldInput[maxlength="1"]');
    logger.info(`[Worker] [STEP_12] Found ${otpInputs.length} OTP inputs`);

    if (otpInputs.length === 0) {
      throw new Error('OTP inputs not found on magic-code page');
    }

    // Вводим по одной цифре в каждый инпут
    const digits = confirmationCode.split('');
    for (let i = 0; i < otpInputs.length; i++) {
      const digit = digits[i] || '';
      await otpInputs[i].click();
      await otpInputs[i].type(digit, { delay: 50 });
    }

    logger.info(`[Worker] [STEP_12] OTP code entered: ${confirmationCode}`);

    // Ждём редиректа на app.lumalabs.ai — страница проходит через 404 → главная
    logger.info('[Worker] [STEP_12] Waiting for redirect to app.lumalabs.ai...');
    await page.waitForURL('https://app.lumalabs.ai/**', {
      timeout: config.playwrightTimeoutMs,
    }).catch(() => {});
    // Даём время на финальный редирект (auth/sign-up 404 → главная)
    await page.waitForTimeout(4000);
    logger.info(`[Worker] [STEP_12] URL after code: ${page.url()}`);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 13: Сохранить успех
    // После ввода кода страница редиректит на app.lumalabs.ai
    // PAGE NOT FOUND на auth/sign-up = регистрация прошла успешно
    // ─────────────────────────────────────────────────────────────────────────
    currentStep = 'STEP_13';

    const cookiesPath = await cookiesService.exportCookies(page, emailRecord.email);
    db.releaseEmail(emailRecord.id, 'registered');
    db.releaseProxy(proxyRecord.id, 'used');
    db.saveRegistration({
      email_id:   emailRecord.id,
      proxy_id:   proxyRecord.id,
      profile_id: null,
      status:     'success',
      credits:    null,
    });
    logger.info(
      `[Worker] [STEP_13] ✓ Registration successful for ${emailRecord.email}. Cookies: ${cookiesPath}`
    );
    return { status: 'success', email: emailRecord.email };

  } catch (err) {
    // =========================================================================
    // ОБРАБОТКА ОШИБОК
    // =========================================================================
    logger.error(
      `[Worker] Error at ${currentStep} for ${emailRecord?.email || 'unknown'}: ${err.message}`,
      { stack: err.stack }
    );

    // Скриншот текущего состояния страницы
    let screenshotPath = null;
    if (page) {
      try {
        fs.mkdirSync('screenshots', { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        screenshotPath = path.join(
          'screenshots',
          `${emailRecord?.email || 'unknown'}_${ts}.png`
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logger.info(`[Worker] Screenshot saved: ${screenshotPath}`);
      } catch (ssErr) {
        logger.warn(`[Worker] Failed to take screenshot: ${ssErr.message}`);
      }
    }

    // Записать в error_logs
    if (db && emailRecord) {
      try {
        db.saveErrorLog({
          email_id: emailRecord.id,
          proxy_id: proxyRecord?.id ?? null,
          step: currentStep,
          error_message: err.message,
          error_stack: err.stack,
          screenshot_path: screenshotPath,
        });
      } catch (dbErr) {
        logger.error(`[Worker] Failed to save error log: ${dbErr.message}`);
      }
    }

    // Обновить статус email: вернуть в очередь или пометить как failed
    if (db && emailRecord) {
      try {
        const isEmailUnavailable = err.message.includes('EMAIL_NOT_AVAILABLE');
        const isProxyError =
          err instanceof ProxyCheckError ||
          err.message.includes('ECONNREFUSED') ||
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('ERR_SOCKS') ||
          err.message.toLowerCase().includes('proxy') ||
          currentStep === 'STEP_3' ||
          currentStep === 'STEP_4';

        if (isEmailUnavailable) {
          // Email уже зарегистрирован — сразу failed, не тратим попытки
          db.releaseEmail(emailRecord.id, 'failed');
          logger.warn(`[Worker] Email ${emailRecord.email} marked as failed (email not available on Luma)`);
        } else if (isProxyError) {
          // Ошибка прокси — НЕ считаем попыткой email, возвращаем в очередь
          db.releaseEmail(emailRecord.id, 'available');
          logger.info(`[Worker] Email ${emailRecord.email} returned to queue (proxy error, attempt not counted)`);
        } else if (emailRecord.attempts + 1 >= config.maxRetries) {
          db.releaseEmail(emailRecord.id, 'failed');
          logger.warn(`[Worker] Email ${emailRecord.email} marked as failed (max retries reached: ${config.maxRetries})`);
        } else {
          db.incrementEmailAttempts(emailRecord.id);
          db.releaseEmail(emailRecord.id, 'available');
          logger.info(
            `[Worker] Email ${emailRecord.email} returned to queue ` +
            `(attempt ${emailRecord.attempts + 1}/${config.maxRetries})`
          );
        }
      } catch (dbErr) {
        logger.error(`[Worker] Failed to update email status: ${dbErr.message}`);
      }
    }

    // Обновить статус прокси: failed если ошибка связана с прокси, иначе available
    if (db && proxyRecord) {
      try {
        const isProxyErr =
          err instanceof ProxyCheckError ||
          err.message.includes('ECONNREFUSED') ||
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('ERR_SOCKS') ||
          err.message.toLowerCase().includes('proxy') ||
          currentStep === 'STEP_3' ||
          currentStep === 'STEP_4';

        if (isProxyErr) {
          db.releaseProxy(proxyRecord.id, 'failed');
          logger.warn(`[Worker] Proxy ${proxyRecord.host}:${proxyRecord.port} marked as failed`);
        } else {
          db.releaseProxy(proxyRecord.id, 'available');
          logger.info(`[Worker] Proxy ${proxyRecord.host}:${proxyRecord.port} returned to available`);
        }
      } catch (dbErr) {
        logger.error(`[Worker] Failed to update proxy status: ${dbErr.message}`);
      }
    }

    return { status: 'error', step: currentStep, error: err.message };

  } finally {
    // Всегда останавливаем профиль AdsPower и закрываем Playwright
    if (profileId && adsPower) {
      try {
        await adsPower.stopProfile(profileId);
      } catch (stopErr) {
        logger.warn(`[Worker] Failed to stop AdsPower profile ${profileId}: ${stopErr.message}`);
      }
      // Удаляем профиль после использования — не засоряем AdsPower
      try {
        await adsPower.deleteProfile(profileId);
      } catch (delErr) {
        logger.warn(`[Worker] Failed to delete AdsPower profile ${profileId}: ${delErr.message}`);
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        logger.warn(`[Worker] Failed to close browser: ${closeErr.message}`);
      }
    }
  }
}

module.exports = { runWorker };
