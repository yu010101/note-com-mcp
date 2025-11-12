#!/usr/bin/env node

/**
 * note.com APIセッションキャプチャツール（Playwright版）
 * ブラウザを起動してユーザーが手動ログイン後、セッション情報を自動取得
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

async function captureNoteSession() {
    console.log('🤖 note.com セッションキャプチャを開始...');
    
    // 認証情報の読み込み
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const envPath = path.join(__dirname, '../.env');
    let email = '';
    let password = '';
    
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        email = envContent.match(/NOTE_EMAIL=(.+)/)?.[1] || '';
        password = envContent.match(/NOTE_PASSWORD=(.+)/)?.[1] || '';
    }
    
    if (!email || !password) {
        console.error('❌ .envファイルにメールアドレスとパスワードを設定してください');
        process.exit(1);
    }
    
    console.log(`📧 メール: ${email}`);
    console.log('\n🌐 ブラウザを起動します...');
    console.log('👉 ブラウザが開いたら、手動でログインしてください');
    console.log('⏳ ログイン完了後、自動でセッション情報を取得します\n');
    
    // Playwrightでブラウザを起動（安定性向上の設定）
    const browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox'
        ],
        slowMo: 100 // 操作を少し遅くして安定性向上
    });
    
    try {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        });
        const page = await context.newPage();
        
        // note.comにアクセス
        console.log('🌐 note.comのログインページを開きます...');
        await page.goto('https://note.com/login', { 
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        
        // ページが完全に読み込まれるまで待つ
        await page.waitForLoadState('networkidle');
        
        console.log('\n📢 ブラウザでログインしてください');
        console.log('   1. メールアドレスとパスワードを入力');
        console.log('   2. ログインボタンをクリック');
        console.log('   3. ログイン完了まで待機します（最大5分）\n');
        
        // ログイン完了を待つ（より安定的な方法）
        console.log('⏳ ログイン完了を待機中...');
        
        // 定期的にURLをチェック
        let loginComplete = false;
        const startTime = Date.now();
        const maxWaitTime = 300000; // 5分
        
        while (!loginComplete && (Date.now() - startTime) < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒ごとにチェック
            const currentUrl = page.url();
            if (!currentUrl.includes('/login')) {
                loginComplete = true;
                console.log('✅ ログインを検出しました！');
            } else {
                // 進行状況を表示
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                process.stdout.write(`\r⏳ 待機中... (${elapsed}秒経過)`);
            }
        }
        
        if (!loginComplete) {
            throw new Error('ログインタイムアウト: 5分以内にログインが完了しませんでした');
        }
        
        console.log('\n'); // 改行
        
        // セッション情報を取得
        const cookies = await context.cookies();
        const sessionCookie = cookies.find(c => c.name === '_note_session_v5');
        const xsrfToken = cookies.find(c => c.name === 'XSRF-TOKEN');
        
        if (!sessionCookie) {
            console.error('❌ セッションCookieが見つかりません');
            throw new Error('Session cookie not found');
        }
        
        // すべてのCookieを文字列化（参照記事の方式に準拠）
        const allCookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
        console.log('🍪 セッション情報を取得しました！');
        console.log(`   SESSION: ${sessionCookie.value.substring(0, 20)}...`);
        console.log(`   XSRF: ${xsrfToken?.value?.substring(0, 20) || 'N/A'}...`);
        console.log(`   Total cookies: ${cookies.length}`);
        
        // .envファイルを更新
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        
        // 既存のセッション情報を削除
        envContent = envContent.replace(/NOTE_SESSION_V5=.*/g, '');
        envContent = envContent.replace(/NOTE_XSRF_TOKEN=.*/g, '');
        envContent = envContent.replace(/NOTE_ALL_COOKIES=.*/g, '');
        envContent = envContent.replace(/\n\n+/g, '\n'); // 空行を整理
        
        // 新しいセッション情報を追加
        if (!envContent.endsWith('\n')) {
            envContent += '\n';
        }
        envContent += `NOTE_SESSION_V5=${sessionCookie.value}\n`;
        if (xsrfToken) {
            envContent += `NOTE_XSRF_TOKEN=${xsrfToken.value}\n`;
        }
        // すべてのCookieも保存（参照記事の方式）
        envContent += `NOTE_ALL_COOKIES=${allCookies}\n`;
        
        fs.writeFileSync(envPath, envContent);
        console.log('✅ .envファイルを更新しました！');
        
        // ユーザー情報も取得
        try {
            const userResponse = await page.goto('https://note.com/api/v2/session');
            const userData = await userResponse.json();
            
            if (userData?.data?.user?.urlname) {
                const userId = userData.data.user.urlname;
                console.log(`👤 ユーザーID: ${userId}`);
                
                // USER_IDも更新
                envContent = fs.readFileSync(envPath, 'utf8');
                envContent = envContent.replace(/NOTE_USER_ID=.*/g, '');
                envContent = envContent.replace(/\n\n+/g, '\n');
                if (!envContent.endsWith('\n')) {
                    envContent += '\n';
                }
                envContent += `NOTE_USER_ID=${userId}\n`;
                fs.writeFileSync(envPath, envContent);
            }
        } catch (error) {
            console.warn('⚠️ ユーザー情報の取得に失敗しました（セッション情報は保存済み）');
        }
        
        console.log('\n🎉 セッションキャプチャ完了！');
        console.log('📝 MCPサーバーを再起動してください。');
        console.log('   npm run start:http');
        
    } catch (error) {
        console.error('❌ エラーが発生しました:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

// 実行
captureNoteSession().catch(console.error);

export { captureNoteSession };
