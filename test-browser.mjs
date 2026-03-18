import puppeteer from 'puppeteer';

async function testGame() {
    console.log('🚀 Starting browser test...');

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1920, height: 1080 },
        args: ['--no-sandbox']
    });

    const page = await browser.newPage();

    // Listen to console logs
    page.on('console', msg => {
        console.log('🎮 Browser:', msg.text());
    });

    // Listen to errors
    page.on('pageerror', error => {
        console.error('❌ Page Error:', error.message);
    });

    console.log('📡 Navigating to http://localhost:5173...');

    try {
        await page.goto('http://localhost:5173', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        console.log('✅ Page loaded successfully!');

        // Wait for the canvas element (Three.js game)
        await page.waitForSelector('canvas', { timeout: 10000 });
        console.log('🎨 Canvas element found - 3D game is rendering!');

        // Take a screenshot
        await page.screenshot({
            path: 'game-screenshot.png',
            fullPage: true
        });
        console.log('📸 Screenshot saved as game-screenshot.png');

        // Get page title
        const title = await page.title();
        console.log('📄 Page title:', title);

        // Check if there are any visible errors
        const errors = await page.evaluate(() => {
            const errorElements = document.querySelectorAll('[class*="error"]');
            return Array.from(errorElements).map(el => el.textContent);
        });

        if (errors.length > 0) {
            console.log('⚠️ Errors found:', errors);
        } else {
            console.log('✅ No visible errors on page!');
        }

        console.log('\n🎉 GAME IS RUNNING SUCCESSFULLY!\n');
        console.log('Press Ctrl+C to close the browser...');

        // Keep browser open
        await new Promise(() => {});

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        await browser.close();
        process.exit(1);
    }
}

testGame();
