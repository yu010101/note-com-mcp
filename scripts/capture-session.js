#!/usr/bin/env node

/**
 * note.com APIセッションキャプチャツール
 * Puppeteerを使用して自動ログインし、認証情報を取得
 */

import puppeteer from 'puppeteer';
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
    
    // システムにインストールされているChromeを使用（ARM64対応）
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ignoreDefaultArgs: ['--disable-extensions']
    });
    
    try {
        const page = await browser.newPage();
        
        // note.comにアクセス
        console.log('🌐 note.comのログインページを開きます...');
        await page.goto('https://note.com/login', { waitUntil: 'networkidle2' });
        
        console.log('\n📢 ブラウザでログインしてください');
        console.log('   1. メールアドレスとパスワードを入力');
        console.log('   2. ログインボタンをクリック');
        console.log('   3. ログイン完了後、自動でセッション情報を取得します\n');
        
        // ログイン完了を待つ（URLがログインページから変わるまで待機）
        console.log('⏳ ログイン完了を待機中...');
        await page.waitForFunction(
            () => !window.location.href.includes('/login'),
            { timeout: 300000 } // 5分待機
        );
        
        console.log('✅ ログインを検出しました！');
        
        // セッション情報を取得
        const cookies = await page.cookies();
        const sessionCookie = cookies.find(c => c.name === '_note_session_v5');
        const xsrfToken = cookies.find(c => c.name === 'XSRF-TOKEN');
        
        if (!sessionCookie) {
            console.error('❌ セッションCookieが見つかりません');
            throw new Error('Session cookie not found');
        }
        
        console.log('🍪 セッション情報を取得しました！');
        console.log(`   SESSION: ${sessionCookie.value.substring(0, 20)}...`);
        console.log(`   XSRF: ${xsrfToken?.value?.substring(0, 20) || 'N/A'}...`);
        
        // .envファイルを更新
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        
        // 既存のセッション情報を削除
        envContent = envContent.replace(/NOTE_SESSION_V5=.*/g, '');
        envContent = envContent.replace(/NOTE_XSRF_TOKEN=.*/g, '');
        
        // 新しいセッション情報を追加
        envContent += `\nNOTE_SESSION_V5=${sessionCookie.value}\n`;
        if (xsrfToken) {
            envContent += `NOTE_XSRF_TOKEN=${xsrfToken.value}\n`;
        }
        
        fs.writeFileSync(envPath, envContent);
        console.log('✅ .envファイルを更新しました！');
        
        // ユーザー情報も取得
        await page.goto('https://note.com/api/v2/session', { waitUntil: 'networkidle2' });
        const userData = await page.evaluate(() => {
            try {
                return JSON.parse(document.body.textContent);
            } catch {
                return null;
            }
        });
        
        if (userData?.data?.user?.urlname) {
            const userId = userData.data.user.urlname;
            console.log(`👤 ユーザーID: ${userId}`);
            
            // USER_IDも更新
            envContent = fs.readFileSync(envPath, 'utf8');
            envContent = envContent.replace(/NOTE_USER_ID=.*/g, '');
            envContent += `NOTE_USER_ID=${userId}\n`;
            fs.writeFileSync(envPath, envContent);
        }
        
        console.log('🎉 セッションキャプチャ完了！');
        console.log('📝 MCPサーバーを再起動してください。');
        
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
