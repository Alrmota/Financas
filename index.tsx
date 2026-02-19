import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// ============================================================================
// CAMADA 1: DOMÍNIO (Entidades e Tipos)
// ============================================================================

type Cents = number; 
type UUID = string;
type ISODate = string;
const APP_VERSION = "1.5.5";

const EXPENSE_CATEGORIES = [
  'Alimentação', 'Veículo', 'Combustível', 'Imposto', 'Moradia', 
  'Lazer', 'Saúde', 'Educação', 'Pix/Transferência', 'Outros'
];

const INCOME_CATEGORIES = [
  'Salário', 'Rendimentos', 'Vendas', 'Reembolso', 'Pix Recebido', 'Outros'
];

interface Account {
  id: UUID;
  name: string;
  type: 'CHECKING' | 'SAVINGS' | 'WALLET';
  balance: Cents;
  currency: 'BRL' | 'USD';
}

interface CreditCard {
  id: UUID;
  name: string;
  limit: Cents;
  closingDay: number; 
  dueDay: number; 
  brand: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO' | 'OUTROS';
}

interface Transaction {
  id: UUID;
  description: string;
  amount: Cents;
  date: ISODate;
  type: 'INCOME' | 'EXPENSE' | 'INVESTMENT' | 'TRANSFER'; // Adicionado TRANSFER para lógica interna
  investmentType?: 'BUY' | 'SELL'; 
  category: string;
  accountId?: UUID; 
  cardId?: UUID;    
  installment?: { current: number; total: number };
  isCleared: boolean;
  assetTicker?: string;
  assetQuantity?: number;
  assetPrice?: Cents;
}

interface InvestmentAsset {
  id: UUID;
  ticker: string;
  quantity: number;
  averagePrice: Cents;
  currentPrice: Cents;
  type: 'STOCK' | 'FII' | 'CRYPTO' | 'FIXED';
  lastUpdate?: string;
}

interface FinancialGoal {
    id: UUID;
    title: string;
    targetAmount: Cents;
    savedAmount?: Cents; 
    linkedAccountId?: UUID; 
    deadline: ISODate;
    type: 'NET_WORTH' | 'INVESTMENTS' | 'CRYPTO' | 'EMERGENCY_FUND' | 'CUSTOM' | 'ACCOUNT_TARGET';
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
  type: 'INFO' | 'WARNING' | 'SUCCESS';
}

interface UserProfile {
  level: number;
  xp: number;
  achievements: string[];
}

interface AppSettings {
    githubRepo: string; 
    githubToken?: string;
}

interface AppState {
  accounts: Account[];
  creditCards: CreditCard[];
  transactions: Transaction[];
  assets: InvestmentAsset[];
  goals: FinancialGoal[];
  notifications: NotificationItem[];
  userProfile: UserProfile;
  settings: AppSettings;
  processedCorporateActionIds: string[]; 
  lastReinvestmentResetDate: string; 
}

// ============================================================================
// CAMADA 2: SERVIÇOS
// ============================================================================

const MoneyService = {
  format: (amount: Cents): string => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(amount / 100);
  },
  parse: (val: number): Cents => Math.round(val * 100),
};

const SoundService = {
  play: (type: 'START' | 'SUCCESS' | 'ERROR') => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        const now = ctx.currentTime;
        
        if (type === 'START') {
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'SUCCESS') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            osc.start(now);
            osc.stop(now + 0.4);
        } else if (type === 'ERROR') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        }
    } catch (e) {
        console.error("Audio error", e);
    }
  }
};

const MarketDataService = {
  BASE_PRICES: {
    'PETR4': 3650, 'VALE3': 6020, 'ITUB4': 3480, 'BBAS3': 2750, 'WEGE3': 5210,
    'HGLG11': 16500, 'MXRF11': 1045, 'KNRI11': 15890, 'XPML11': 11590,
    'BTC': 38000000, 'ETH': 1500000, 'USDT': 560
  } as Record<string, number>,

  fetchPrice: async (ticker: string): Promise<Cents> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const cleanTicker = ticker.toUpperCase().trim();
    const basePrice = MarketDataService.BASE_PRICES[cleanTicker] || 10000; 
    const variation = (Math.random() * 0.04) - 0.02; 
    const currentPrice = Math.round(basePrice * (1 + variation));
    return currentPrice;
  },

  fetchUpcomingDividends: async (): Promise<any[]> => {
    return [];
  }
};

const CreditCardService = {
  generateInstallmentPlan: (card: CreditCard, amount: Cents, totalInstallments: number, description: string, category: string, purchaseDate: Date): Transaction[] => {
    const transactions: Transaction[] = [];
    const installmentValue = Math.round(amount / totalInstallments);
    const pDate = new Date(purchaseDate);
    
    let targetMonth = pDate.getMonth();
    let targetYear = pDate.getFullYear();

    if (pDate.getDate() >= card.closingDay) {
      targetMonth++; 
    }

    for (let i = 0; i < totalInstallments; i++) {
      const dueDate = new Date(targetYear, targetMonth + 1 + i, card.dueDay); 
      transactions.push({
        id: `txn-${Date.now()}-${i}`,
        description: `${description} (${i + 1}/${totalInstallments})`,
        amount: installmentValue,
        date: dueDate.toISOString(),
        type: 'EXPENSE',
        category: category,
        cardId: card.id,
        isCleared: false,
        installment: { current: i + 1, total: totalInstallments }
      });
    }
    return transactions;
  },

  calculateInvoiceTotal: (transactions: Transaction[], cardId: UUID, monthOffset: number = 0): Cents => {
    const today = new Date();
    const targetDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    
    return transactions
      .filter(t => t.cardId === cardId && t.type === 'EXPENSE')
      .filter(t => {
        const tDate = new Date(t.date);
        return tDate.getMonth() === targetDate.getMonth() && tDate.getFullYear() === targetDate.getFullYear();
      })
      .reduce((acc, t) => acc + t.amount, 0);
  },

  calculateTotalUsedLimit: (transactions: Transaction[], cardId: UUID): Cents => {
     return transactions
      .filter(t => t.cardId === cardId && t.type === 'EXPENSE' && !t.isCleared)
      .reduce((acc, t) => acc + t.amount, 0);
  }
};

const InvestmentService = {
  calculateNetWorth: (accounts: Account[], assets: InvestmentAsset[]): Cents => {
    const cash = accounts.reduce((acc, a) => acc + a.balance, 0);
    const invested = assets.reduce((acc, a) => acc + (a.quantity * a.currentPrice), 0);
    return cash + invested;
  },
  
  calculateHistory: (accounts: Account[], assets: InvestmentAsset[], transactions: Transaction[], days: number): number[] => {
    const history: number[] = [];
    let currentNetWorth = InvestmentService.calculateNetWorth(accounts, assets);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const sortedTxns = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    for (let i = 0; i < days; i++) {
      history.unshift(currentNetWorth);
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() - i);
      targetDate.setHours(0, 0, 0, 0);
      const txnsOnThisDay = sortedTxns.filter(t => {
        const tDate = new Date(t.date);
        return tDate.getDate() === targetDate.getDate() && 
               tDate.getMonth() === targetDate.getMonth() && 
               tDate.getFullYear() === targetDate.getFullYear();
      });
      txnsOnThisDay.forEach(t => {
        if (t.type === 'INCOME' || (t.type === 'INVESTMENT' && t.investmentType === 'SELL')) {
          currentNetWorth -= t.amount;
        } else if (t.type === 'EXPENSE' || (t.type === 'INVESTMENT' && t.investmentType === 'BUY')) {
          currentNetWorth += t.amount;
        }
      });
    }
    return history;
  }
};

const GoalService = {
    calculateProgress: (goal: FinancialGoal, state: AppState): Cents => {
        if (goal.linkedAccountId) {
            const account = state.accounts.find(a => a.id === goal.linkedAccountId);
            return account ? account.balance : 0;
        }
        if (goal.type === 'CUSTOM' || goal.type === 'EMERGENCY_FUND') {
            return goal.savedAmount || 0;
        }
        switch(goal.type) {
            case 'NET_WORTH':
                return InvestmentService.calculateNetWorth(state.accounts, state.assets);
            case 'INVESTMENTS':
                return state.assets
                    .filter(a => a.type === 'STOCK' || a.type === 'FII' || a.type === 'FIXED')
                    .reduce((acc, a) => acc + (a.quantity * a.currentPrice), 0);
            case 'CRYPTO':
                return state.assets
                    .filter(a => a.type === 'CRYPTO')
                    .reduce((acc, a) => acc + (a.quantity * a.currentPrice), 0);
            default: return 0;
        }
    }
}

const AIService = {
    parseTransaction: async (text: string, state: AppState): Promise<Partial<Transaction> | null> => {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const accountContext = state.accounts.map(a => `${a.name} (ID: ${a.id})`).join(', ');
            const cardContext = state.creditCards.map(c => `${c.name} (ID: ${c.id})`).join(', ');
            const today = new Date().toISOString();

            const prompt = `
                Role: Financial Assistant AI (Brazilian Portuguese).
                Task: Extract transaction details from user voice command.
                
                Context:
                - Date Today: ${today}
                - Accounts (ID/Name): ${accountContext}
                - Cards (ID/Name): ${cardContext}
                - Categories: ${[...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].join(', ')}

                Instructions:
                1. **Amount**: Extract numeric value to CENTS. "50 reais" = 5000.
                2. **Type**: "Ganhei/Recebi/Depósito" = INCOME. "Gastei/Paguei/Comprei/Saque" = EXPENSE. "Investi/Comprei Ação" = INVESTMENT. "Transferi" = TRANSFER.
                3. **Category**: Match closest standard category.
                4. **Date**: Parse relative dates (hoje, ontem) to YYYY-MM-DD.
                5. **Description**: Brief summary.
                
                Input: "${text}"
                
                Return JSON only.
            `;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-lite-latest',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                }
            });

            if (response.text) {
                return JSON.parse(response.text);
            }
            return null;

        } catch (error) {
            console.error("AI Parse Error", error);
            return null;
        }
    }
}

const GithubService = {
    checkUpdate: async (repo: string, currentVersion: string) => {
        try {
            const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
            if (!response.ok) return { error: 'Repo não encontrado' };
            const data = await response.json();
            const remoteVersion = data.tag_name.replace('v', '');
            return {
                hasUpdate: remoteVersion !== currentVersion,
                remoteVersion
            };
        } catch (e) {
            return { error: 'Erro de conexão' };
        }
    }
};

// ============================================================================
// CAMADA 3: UI
// ============================================================================

const Icons = {
  Home: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>,
  Card: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>,
  Bank: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M5 21V7l8-4 8 4v14M10 10a2 2 0 1 1 4 0 2 2 0 0 1-4 0z" /></svg>,
  TrendingUp: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>,
  Settings: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1 2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>,
  Plus: () => <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>,
  Mic: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>,
  ArrowUp: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C853" strokeWidth="2"><polyline points="18 15 12 9 6 15"></polyline></svg>,
  ArrowDown: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF5252" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>,
  Exchange: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFAB00" strokeWidth="2"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>,
  Wallet: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"></path></svg>,
  Lock: () => <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
  Edit: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>,
  Trash: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF5252" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>,
  Bell: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>,
  Download: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>,
  Upload: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>,
  Target: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>,
  Github: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>,
  ArrowRight: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>,
  ChevronLeft: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg>,
  Cloud: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>,
  Link: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
};

const Card = ({ children, style, onClick }: any) => (
  <div onClick={onClick} style={{
    background: '#1e293b', borderRadius: 16, padding: 20,
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    border: '1px solid rgba(255,255,255,0.05)',
    cursor: onClick ? 'pointer' : 'default',
    ...style
  }}>{children}</div>
);

const inputStyle = {
  width: '100%', padding: 12, background: '#0f172a', border: '1px solid #334155',
  borderRadius: 8, color: 'white', fontSize: 16, outline: 'none', boxSizing: 'border-box' as const
};

const btnStyle = {
  width: '100%', padding: 14, background: '#2979FF', border: 'none',
  borderRadius: 8, color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: 16
};

const actionBtnStyle = {
    background: '#334155', border: 'none', color: 'white', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14
};

const menuItemStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,0.05)',
    cursor: 'pointer'
};

const menuIconStyle = {
    width: 32, height: 32, borderRadius: 8, background: '#334155',
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8'
};

const sendSystemNotification = (title: string, body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
    }
};

const Modal = ({ title, onClose, children }: { title: string, onClose: () => void, children: React.ReactNode }) => (
  <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', padding: 20 }}>
    <div style={{ background: '#1e293b', padding: 24, borderRadius: 16, width: '100%', maxWidth: 400, border: '1px solid rgba(255,255,255,0.1)', maxHeight: '90vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4, fontSize: 20 }}>×</button> 
      </div>
      {children}
    </div>
  </div>
);

const Input = ({ label, ...props }: any) => (
  <div style={{ marginBottom: 16 }}>
    <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{label}</label>
    <input style={inputStyle} {...props} />
  </div>
);

const CurrencyInput = ({ value, onChange, label, autoFocus }: { value: Cents, onChange: (val: Cents) => void, label: string, autoFocus?: boolean }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '');
    onChange(Number(digits));
  };

  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value / 100);

  return (
    <div style={{ marginBottom: 12, flex: 1 }}>
      <label style={{ fontSize: 12, color: '#94a3b8' }}>{label}</label>
      <input
        type="tel"
        value={formatted}
        onChange={handleChange}
        autoFocus={autoFocus}
        style={{ ...inputStyle, fontSize: 24, fontWeight: 'bold', color: '#00C853' }} 
      />
    </div>
  );
};

const RollingNumber = ({ value }: { value: number }) => {
  const [display, setDisplay] = useState(value);
  useEffect(() => { setDisplay(value); }, [value]);
  return <span>{MoneyService.format(display)}</span>;
};

const Badge = () => (
    <div style={{
        width: 10, height: 10, borderRadius: '50%', background: '#FF5252',
        position: 'absolute', top: 0, right: 0, border: '2px solid #0f172a'
    }} />
);

const NetWorthChart = ({ history }: { history: number[] }) => {
  const points = history.map((val, i) => {
    const x = (i / (history.length - 1)) * 100;
    const max = Math.max(...history, 1);
    const min = Math.min(...history, 0);
    const range = max - min;
    const y = 100 - (((val - min) / (range || 1)) * 100);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height="60" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{stopColor:'#00C853', stopOpacity:0.5}} />
          <stop offset="100%" style={{stopColor:'#00C853', stopOpacity:0}} />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke="#00C853" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,100 ${points} 100,100`} fill="url(#grad)" />
    </svg>
  );
};

const TransactionRow = ({ t, onDelete }: { t: Transaction, onDelete?: (id: string) => void }) => {
  const isIncome = t.type === 'INCOME';
  const isInvestment = t.type === 'INVESTMENT';
  
  let color = '#FF5252';
  let bg = '#FF525222';
  let Icon = Icons.ArrowDown;
  let sign = '-';

  if (isIncome) {
    color = '#00C853';
    bg = '#00C85322';
    Icon = Icons.ArrowUp;
    sign = '+';
  } else if (isInvestment) {
    if (t.investmentType === 'SELL') {
      color = '#00C853'; 
      bg = '#00C85322';
      Icon = Icons.Exchange;
      sign = '+';
    } else {
      color = '#FFAB00'; 
      bg = '#FFAB0022';
      Icon = Icons.Exchange;
      sign = '';
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #ffffff08' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ background: bg, padding: 8, borderRadius: 8 }}>
          <Icon />
        </div>
        <div>
          <div style={{ fontWeight: 500 }}>{t.description}</div>
          <div style={{ fontSize: 12, opacity: 0.5 }}>
            {t.category} • {t.installment ? `${t.installment.current}/${t.installment.total}` : (isInvestment ? `${t.investmentType === 'SELL' ? 'Venda' : 'Compra'} ${t.assetTicker}` : 'À vista')} • {new Date(t.date).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ color: color, fontWeight: 600 }}>
            {sign}{MoneyService.format(t.amount)}
        </div>
        {onDelete && (
             <button 
             onClick={(e) => {
                 e.stopPropagation();
                 if(window.confirm('Excluir transação?')) onDelete(t.id);
             }} 
             style={{background: 'rgba(255, 255, 255, 0.1)', border: 'none', color: '#FF5252', cursor: 'pointer', padding: 10, borderRadius: 8, marginLeft: 8}}
            >
                <Icons.Trash />
            </button>
        )}
      </div>
    </div>
  );
};

// --- TELAS ---

const HomeScreen = ({ state, onOpenSettings, unreadCount }: { state: AppState, onOpenSettings: () => void, unreadCount: number }) => {
  const netWorth = InvestmentService.calculateNetWorth(state.accounts, state.assets);
  
  const history = useMemo(() => {
    let days = 30; 
    if (state.transactions.length > 0) {
        const dates = state.transactions.map(t => new Date(t.date).getTime());
        const minDate = Math.min(...dates);
        const now = new Date().getTime();
        const diffTime = Math.abs(now - minDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        days = Math.min(Math.max(diffDays, 1), 90);
    }
    return InvestmentService.calculateHistory(state.accounts, state.assets, state.transactions, days);
  }, [state.transactions, state.accounts, state.assets]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 14, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>Patrimônio Líquido</h2>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700 }}><RollingNumber value={netWorth} /></h1>
        </div>
        <button 
            onClick={onOpenSettings} 
            style={{ 
                background: '#1e293b', border: '1px solid rgba(255,255,255,0.05)', 
                color: '#94a3b8', padding: 10, borderRadius: 12, cursor: 'pointer', position: 'relative',
                transform: 'scale(0.85)', transformOrigin: 'top right' 
            }}
        >
            <Icons.Settings />
            {unreadCount > 0 && <Badge />}
        </button>
      </div>

      <Card style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Resumo Financeiro</h3>
        </div>
        <NetWorthChart history={history} />
      </Card>

      <h3 style={{ fontSize: 18, marginBottom: 16 }}>Resumo de Contas</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {state.accounts.map(acc => (
          <Card key={acc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ background: '#2979FF22', padding: 8, borderRadius: 8, color: '#2979FF' }}><Icons.Wallet /></div>
              <div>
                <div style={{ fontWeight: 600 }}>{acc.name}</div>
                <div style={{ fontSize: 12, opacity: 0.5 }}>{acc.type === 'CHECKING' ? 'Conta Corrente' : 'Poupança'}</div>
              </div>
            </div>
            <div style={{ fontWeight: 600 }}><RollingNumber value={acc.balance} /></div>
          </Card>
        ))}
        {state.accounts.length === 0 && <p style={{opacity: 0.5, fontSize: 14}}>Nenhuma conta. Vá em configurações.</p>}
      </div>
    </div>
  );
};

const BankScreen = ({ state, onDeleteTransaction }: { state: AppState, onDeleteTransaction: (id: string) => void }) => {
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
    const [showFullHistory, setShowFullHistory] = useState(false);

    const recentTxns = useMemo(() => {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return state.transactions
            .filter(t => t.accountId && !t.cardId)
            .filter(t => new Date(t.date) >= sevenDaysAgo)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [state.transactions]);

    const allTxns = useMemo(() => {
        return state.transactions
            .filter(t => t.accountId && !t.cardId)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [state.transactions]);

    const accountTxns = useMemo(() => {
        if (!selectedAccount) return [];
        return state.transactions
            .filter(t => t.accountId === selectedAccount.id)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [state.transactions, selectedAccount]);

    const displayTxns = showFullHistory ? allTxns : recentTxns;

    return (
        <div style={{ padding: 24 }}>
            {!selectedAccount ? (
                <>
                    <h2 style={{ marginBottom: 24 }}>Minhas Contas</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                        {state.accounts.map(acc => (
                            <Card key={acc.id} onClick={() => setSelectedAccount(acc)} style={{ cursor: 'pointer' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{ background: '#2979FF22', padding: 8, borderRadius: 8, color: '#2979FF' }}><Icons.Bank /></div>
                                        <div>
                                            <div style={{ fontWeight: 600 }}>{acc.name}</div>
                                            <div style={{ fontSize: 12, opacity: 0.5 }}>{acc.type === 'CHECKING' ? 'Conta Corrente' : 'Poupança'}</div>
                                        </div>
                                    </div>
                                    <div style={{ fontWeight: 600 }}>{MoneyService.format(acc.balance)}</div>
                                </div>
                            </Card>
                        ))}
                        {state.accounts.length === 0 && <p style={{ opacity: 0.5 }}>Nenhuma conta cadastrada.</p>}
                    </div>

                    <h3 style={{ fontSize: 18, marginBottom: 12 }}>Extrato</h3>
                    <div>
                        {displayTxns.length === 0 && <p style={{ opacity: 0.5, fontSize: 14 }}>Nenhuma movimentação.</p>}
                        {displayTxns.map(t => (
                            <TransactionRow key={t.id} t={t} />
                        ))}
                    </div>
                    {state.transactions.some(t => t.accountId && !t.cardId) && (
                         <button onClick={() => setShowFullHistory(!showFullHistory)} style={{...actionBtnStyle, marginTop: 16}}>
                             {showFullHistory ? 'Ver Extrato Resumido' : 'Ver Extrato Completo'}
                         </button>
                    )}
                </>
            ) : (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, gap: 12 }}>
                        <div onClick={() => setSelectedAccount(null)} style={{ cursor: 'pointer', padding: 4, borderRadius: '50%', background: '#334155' }}>
                            <Icons.ChevronLeft />
                        </div>
                        <h2 style={{ fontSize: 24, margin: 0 }}>{selectedAccount.name}</h2>
                    </div>
                    <Card style={{ marginBottom: 24, textAlign: 'center' }}>
                        <div style={{ fontSize: 14, opacity: 0.6 }}>Saldo Atual</div>
                        <div style={{ fontSize: 32, fontWeight: 700, color: selectedAccount.balance >= 0 ? '#00C853' : '#FF5252' }}>
                            {MoneyService.format(selectedAccount.balance)}
                        </div>
                    </Card>
                    <h3 style={{ fontSize: 18 }}>Extrato</h3>
                    <div>
                        {accountTxns.length === 0 && <p style={{ opacity: 0.5 }}>Nenhuma movimentação.</p>}
                        {accountTxns.map(t => (
                            <TransactionRow key={t.id} t={t} onDelete={onDeleteTransaction} />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

const CardsScreen = ({ state, onDeleteTransaction }: { state: AppState, onDeleteTransaction: (id: string) => void }) => {
    const [selectedCard, setSelectedCard] = useState<CreditCard | null>(null);
    const [showFullHistory, setShowFullHistory] = useState(false);

    const recentTxns = useMemo(() => {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return state.transactions
            .filter(t => t.cardId && t.type === 'EXPENSE')
            .filter(t => new Date(t.date) >= sevenDaysAgo)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [state.transactions]);

    const allTxns = useMemo(() => {
        return state.transactions
            .filter(t => t.cardId && t.type === 'EXPENSE')
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [state.transactions]);

    const cardTxns = useMemo(() => {
        if (!selectedCard) return [];
        return state.transactions
            .filter(t => t.cardId === selectedCard.id)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [state.transactions, selectedCard]);

    const displayTxns = showFullHistory ? allTxns : recentTxns;

    return (
        <div style={{ padding: 24 }}>
            {!selectedCard ? (
                <>
                    <h2 style={{ marginBottom: 24 }}>Meus Cartões</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                        {state.creditCards.map(card => {
                            const used = CreditCardService.calculateTotalUsedLimit(state.transactions, card.id);
                            const available = card.limit - used;
                            const percent = Math.min((used / card.limit) * 100, 100);
                            
                            return (
                                <Card key={card.id} onClick={() => setSelectedCard(card)} style={{ cursor: 'pointer' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                        <div style={{ fontWeight: 600 }}>{card.name}</div>
                                        <div style={{ fontSize: 12, opacity: 0.6 }}>{card.brand}</div>
                                    </div>
                                    <div style={{ marginBottom: 8 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                            <span>Fatura Atual</span>
                                            <span>{MoneyService.format(CreditCardService.calculateInvoiceTotal(state.transactions, card.id))}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                            <span>Disponível</span>
                                            <span style={{color: '#00C853'}}>{MoneyService.format(available)}</span>
                                        </div>
                                    </div>
                                    <div style={{ width: '100%', height: 6, background: '#334155', borderRadius: 3 }}>
                                        <div style={{ width: `${percent}%`, height: '100%', background: percent > 90 ? '#FF5252' : '#2979FF', borderRadius: 3 }}></div>
                                    </div>
                                </Card>
                            );
                        })}
                         {state.creditCards.length === 0 && <p style={{ opacity: 0.5 }}>Nenhum cartão cadastrado.</p>}
                    </div>

                    <h3 style={{ fontSize: 18, marginBottom: 12 }}>Transações</h3>
                    <div>
                        {displayTxns.length === 0 && <p style={{ opacity: 0.5, fontSize: 14 }}>Nenhuma compra recente.</p>}
                        {displayTxns.map(t => (
                            <TransactionRow key={t.id} t={t} />
                        ))}
                    </div>
                    {state.transactions.some(t => t.cardId) && (
                         <button onClick={() => setShowFullHistory(!showFullHistory)} style={{...actionBtnStyle, marginTop: 16}}>
                             {showFullHistory ? 'Ver Extrato Resumido' : 'Ver Extrato Completo'}
                         </button>
                    )}
                </>
            ) : (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, gap: 12 }}>
                        <div onClick={() => setSelectedCard(null)} style={{ cursor: 'pointer', padding: 4, borderRadius: '50%', background: '#334155' }}>
                            <Icons.ChevronLeft />
                        </div>
                        <h2 style={{ fontSize: 24, margin: 0 }}>{selectedCard.name}</h2>
                    </div>
                    
                    <div style={{display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16}}>
                        {[0, 1, 2].map(offset => {
                            const total = CreditCardService.calculateInvoiceTotal(state.transactions, selectedCard.id, offset);
                            const dateForLabel = new Date();
                            dateForLabel.setMonth(dateForLabel.getMonth() + offset);
                            const monthName = dateForLabel.toLocaleString('pt-BR', { month: 'long' });
                            
                            return (
                                <Card key={offset} style={{minWidth: 140, padding: 16, border: offset === 0 ? '1px solid #2979FF' : 'none'}}>
                                    <div style={{textTransform: 'capitalize', fontSize: 14, marginBottom: 8}}>{monthName}</div>
                                    <div style={{fontSize: 18, fontWeight: 700}}>{MoneyService.format(total)}</div>
                                </Card>
                            )
                        })}
                    </div>

                    <h3 style={{ fontSize: 18, marginTop: 12 }}>Transações</h3>
                    <div>
                        {cardTxns.map(t => (
                            <TransactionRow key={t.id} t={t} onDelete={onDeleteTransaction} />
                        ))}
                         {cardTxns.length === 0 && <p style={{ opacity: 0.5 }}>Nenhuma transação.</p>}
                    </div>
                </>
            )}
        </div>
    );
};

const SettingsScreen = ({ 
  state, 
  onSaveCard, 
  onDeleteCard, 
  onSaveAccount, 
  onDeleteAccount,
  onImportData,
  onUpdateSettings,
  onMarkAsRead,
  onSaveGoal,
  onDeleteGoal,
  onUpdateGoalAmount
}: { 
  state: AppState, 
  onSaveCard: (c: CreditCard) => void, 
  onDeleteCard: (id: string) => void,
  onSaveAccount: (a: Account) => void,
  onDeleteAccount: (id: string) => void,
  onImportData: (data: AppState) => void,
  onUpdateSettings: (settings: AppSettings) => void,
  onMarkAsRead: (id: string) => void,
  onSaveGoal: (g: FinancialGoal) => void,
  onDeleteGoal: (id: string) => void,
  onUpdateGoalAmount: (id: string, amount: Cents) => void
}) => {
  const [currentView, setCurrentView] = useState<'MAIN' | 'ACCOUNTS' | 'CARDS' | 'SYSTEM' | 'CLOUD' | 'NOTIFICATIONS' | 'GOALS'>('MAIN');
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isCardModalOpen, setCardModalOpen] = useState(false);
  const [isAccountModalOpen, setAccountModalOpen] = useState(false);
  
  const [isGoalModalOpen, setGoalModalOpen] = useState(false);
  const [goalForm, setGoalForm] = useState({ title: '', target: '', date: '', type: 'NET_WORTH', linkedAccountId: '' });
  const [selectedGoal, setSelectedGoal] = useState<FinancialGoal | null>(null);
  const [operationAmount, setOperationAmount] = useState<Cents>(0);

  const [cardForm, setCardForm] = useState({ id: '', name: '', limit: '', closing: '', due: '', brand: 'MASTERCARD' });
  const [accountForm, setAccountForm] = useState({ id: '', name: '', type: 'CHECKING' });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [remoteVersion, setRemoteVersion] = useState('');
  const [repoUrl, setRepoUrl] = useState(state.settings?.githubRepo || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const unreadCount = useMemo(() => state.notifications.filter(n => !n.read).length, [state.notifications]);
  const unreadNotifications = useMemo(() => state.notifications.filter(n => !n.read), [state.notifications]);

  const openCardModal = (card?: CreditCard) => {
    if (card) {
      setCardForm({
        id: card.id,
        name: card.name,
        limit: (card.limit / 100).toFixed(2),
        closing: card.closingDay.toString(),
        due: card.dueDay.toString(),
        brand: card.brand
      });
      setEditingCard(card);
    } else {
      setCardForm({ id: '', name: '', limit: '', closing: '', due: '', brand: 'MASTERCARD' });
      setEditingCard(null);
    }
    setCardModalOpen(true);
  };

  const openAccountModal = (account?: Account) => {
    if (account) {
      setAccountForm({
        id: account.id,
        name: account.name,
        type: account.type
      });
      setEditingAccount(account);
    } else {
      setAccountForm({ id: '', name: '', type: 'CHECKING' });
      setEditingAccount(null);
    }
    setAccountModalOpen(true);
  }

  const handleCardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveCard({
      id: editingCard ? editingCard.id : `card-${Date.now()}`,
      name: cardForm.name,
      limit: MoneyService.parse(parseFloat(cardForm.limit)),
      closingDay: parseInt(cardForm.closing),
      dueDay: parseInt(cardForm.due),
      brand: cardForm.brand as any
    });
    setCardModalOpen(false);
  };

  const handleAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveAccount({
      id: editingAccount ? editingAccount.id : `acc-${Date.now()}`,
      name: accountForm.name,
      balance: editingAccount ? editingAccount.balance : 0, 
      type: accountForm.type as any,
      currency: 'BRL'
    });
    setAccountModalOpen(false);
  }

  const handleGoalSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      onSaveGoal({
          id: `goal-${Date.now()}`,
          title: goalForm.title,
          targetAmount: MoneyService.parse(parseFloat(goalForm.target)),
          deadline: goalForm.date,
          type: goalForm.type as any,
          linkedAccountId: goalForm.linkedAccountId || undefined
      });
      setGoalModalOpen(false);
      setGoalForm({ title: '', target: '', date: '', type: 'NET_WORTH', linkedAccountId: '' });
  };

  const handleGoalOperation = (type: 'DEPOSIT' | 'WITHDRAW') => {
      if(!selectedGoal || !operationAmount) return;
      
      const newAmount = type === 'DEPOSIT' ? operationAmount : -operationAmount;
      onUpdateGoalAmount(selectedGoal.id, newAmount);
      setSelectedGoal(null);
      setOperationAmount(0);
  }

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `zenith_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const json = JSON.parse(e.target?.result as string);
            if (json.accounts && json.transactions) {
                onImportData(json);
                alert('Dados importados com sucesso!');
            } else {
                alert('Arquivo inválido.');
            }
        } catch (err) {
            alert('Erro ao ler arquivo.');
        }
    };
    reader.readAsText(file);
  };

  const handleCheckUpdate = async () => {
    if (!repoUrl) {
        alert("Configure o repositório GitHub primeiro (ex: usuario/meu-app)");
        return;
    }
    onUpdateSettings({...state.settings, githubRepo: repoUrl});
    
    setCheckingUpdate(true);
    const result = await GithubService.checkUpdate(repoUrl, APP_VERSION);
    setCheckingUpdate(false);
    
    if (result.hasUpdate && result.remoteVersion) {
        setUpdateAvailable(true);
        setRemoteVersion(result.remoteVersion);
    } else if (result.error) {
        alert("Erro ao verificar atualização: " + result.error);
    } else {
        alert("Você já está na versão mais recente.");
    }
  };

  const renderMainView = () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div onClick={() => setCurrentView('NOTIFICATIONS')} style={menuItemStyle}>
              <div style={{display: 'flex', alignItems: 'center', gap: 12, position: 'relative'}}>
                  <div style={menuIconStyle}><Icons.Bell /></div>
                  <div style={{fontSize: 16, fontWeight: 500}}>Notificações</div>
                  {unreadCount > 0 && (
                      <div style={{
                          background: '#FF5252', color: 'white', borderRadius: '50%',
                          minWidth: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 700, marginLeft: 8
                      }}>{unreadCount}</div>
                  )}
              </div>
              <div style={{display: 'flex', alignItems: 'center'}}>
                 {unreadCount > 0 && <div style={{width: 8, height: 8, background: '#FF5252', borderRadius: '50%', marginRight: 12}}></div>}
                 <Icons.ArrowRight />
              </div>
          </div>
          <div onClick={() => setCurrentView('GOALS')} style={menuItemStyle}>
              <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                  <div style={menuIconStyle}><Icons.Target /></div>
                  <div style={{fontSize: 16, fontWeight: 500}}>Metas Financeiras</div>
              </div>
              <Icons.ArrowRight />
          </div>
          <div onClick={() => setCurrentView('ACCOUNTS')} style={menuItemStyle}>
              <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                  <div style={menuIconStyle}><Icons.Bank /></div>
                  <div style={{fontSize: 16, fontWeight: 500}}>Contas Bancárias</div>
              </div>
              <Icons.ArrowRight />
          </div>
          <div onClick={() => setCurrentView('CARDS')} style={menuItemStyle}>
              <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                  <div style={menuIconStyle}><Icons.Card /></div>
                  <div style={{fontSize: 16, fontWeight: 500}}>Cartões de Crédito</div>
              </div>
              <Icons.ArrowRight />
          </div>
          <div onClick={() => setCurrentView('SYSTEM')} style={menuItemStyle}>
              <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                  <div style={menuIconStyle}><Icons.Settings /></div>
                  <div style={{fontSize: 16, fontWeight: 500}}>Sistema e Atualizações</div>
              </div>
              <Icons.ArrowRight />
          </div>
          <div onClick={() => setCurrentView('CLOUD')} style={menuItemStyle}>
              <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                  <div style={menuIconStyle}><Icons.Cloud /></div>
                  <div style={{fontSize: 16, fontWeight: 500}}>Backup e Dados</div>
              </div>
              <Icons.ArrowRight />
          </div>
      </div>
  );

  const renderNotificationsView = () => (
     <div>
       {unreadNotifications.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, opacity: 0.6 }}>
          <Icons.Bell />
          <p>Tudo limpo! Nenhuma nova notificação.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {unreadNotifications.map(n => (
            <Card 
                key={n.id} 
                onClick={() => onMarkAsRead(n.id)}
                style={{ 
                    borderLeft: `4px solid ${n.type === 'SUCCESS' ? '#00C853' : n.type === 'WARNING' ? '#FFAB00' : '#2979FF'}`,
                    cursor: 'pointer'
                }}
            >
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{n.title}</div>
                <div style={{ width: 8, height: 8, background: '#FF5252', borderRadius: '50%'}}></div>
              </div>
              <div style={{ fontSize: 14, opacity: 0.8 }}>{n.message}</div>
              <div style={{ fontSize: 12, opacity: 0.4, marginTop: 8 }}>{new Date(n.date).toLocaleDateString('pt-BR')} • Toque para marcar como lida</div>
            </Card>
          ))}
        </div>
      )}
     </div>
  );

  const renderAccountsView = () => (
    <div>
        <div style={{ marginBottom: 16 }}>
            <button onClick={() => openAccountModal()} style={actionBtnStyle}>+ Adicionar Conta</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {state.accounts.map(acc => (
                <Card key={acc.id} onClick={() => openAccountModal(acc)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <div style={{ fontWeight: 600 }}>{acc.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.5 }}>{acc.type === 'CHECKING' ? 'Corrente' : 'Poupança'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div>{MoneyService.format(acc.balance)}</div>
                        <button onClick={(e) => { e.stopPropagation(); onDeleteAccount(acc.id); }} style={{ color: '#FF5252', background: 'none', border: 'none', cursor: 'pointer' }}><Icons.Trash /></button>
                    </div>
                </Card>
            ))}
        </div>
    </div>
);

const renderCardsView = () => (
    <div>
        <div style={{ marginBottom: 16 }}>
            <button onClick={() => openCardModal()} style={actionBtnStyle}>+ Adicionar Cartão</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {state.creditCards.map(card => (
                <Card key={card.id} onClick={() => openCardModal(card)} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ fontWeight: 600 }}>{card.name}</div>
                        <button onClick={(e) => { e.stopPropagation(); onDeleteCard(card.id); }} style={{ color: '#FF5252', background: 'none', border: 'none', cursor: 'pointer' }}><Icons.Trash /></button>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.5 }}>Limite: {MoneyService.format(card.limit)}</div>
                    <div style={{ fontSize: 12, opacity: 0.5 }}>Fecha dia {card.closingDay} • Vence dia {card.dueDay}</div>
                </Card>
            ))}
        </div>
    </div>
);

const renderGoalsView = () => (
    <div>
        <div style={{ marginBottom: 16 }}>
            <button onClick={() => setGoalModalOpen(true)} style={actionBtnStyle}>+ Nova Meta</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {state.goals.map((goal: FinancialGoal) => {
                const current = GoalService.calculateProgress(goal, state);
                const percent = Math.min((current / goal.targetAmount) * 100, 100);
                const timeLeft = Math.ceil((new Date(goal.deadline).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
                const linkedAccount = goal.linkedAccountId ? state.accounts.find(a => a.id === goal.linkedAccountId) : null;
                
                return (
                    <Card key={goal.id} onClick={() => setSelectedGoal(goal)} style={{cursor: 'pointer'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 12}}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                                <div style={{fontWeight: 600, fontSize: 18}}>{goal.title}</div>
                                {linkedAccount && (
                                    <div style={{display: 'flex', alignItems: 'center', gap: 4, background: '#2979FF22', color: '#2979FF', padding: '2px 8px', borderRadius: 4, fontSize: 10}}>
                                        <Icons.Link />
                                        {linkedAccount.name}
                                    </div>
                                )}
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); onDeleteGoal(goal.id); }} style={{color: '#FF5252', background: 'none', border: 'none', cursor: 'pointer'}}><Icons.Trash /></button>
                        </div>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8}}>
                            <div style={{fontSize: 28, fontWeight: 700, color: '#00C853'}}>{MoneyService.format(current)}</div>
                            <div style={{fontSize: 14, color: '#94a3b8', paddingBottom: 6}}>de {MoneyService.format(goal.targetAmount)}</div>
                        </div>
                        <div style={{width: '100%', height: 10, background: '#334155', borderRadius: 5, marginBottom: 12}}>
                            <div style={{width: `${percent}%`, height: '100%', background: percent >= 100 ? '#FFD700' : '#2979FF', borderRadius: 5, transition: 'width 1s'}}></div>
                        </div>
                        <div style={{fontSize: 12, opacity: 0.6}}>
                            {timeLeft > 0 ? `${timeLeft} dias restantes` : 'Prazo finalizado'} • {new Date(goal.deadline).toLocaleDateString('pt-BR')}
                        </div>
                    </Card>
                )
            })}
             {state.goals.length === 0 && <p style={{ opacity: 0.5 }}>Nenhuma meta definida.</p>}
        </div>
    </div>
);

const renderSystemView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
            <h3 style={{ marginTop: 0 }}>Sobre</h3>
            <p>Zenith SuperApp v{APP_VERSION}</p>
            <div style={{ marginTop: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>GitHub Repo</label>
                <div style={{ display: 'flex', gap: 8 }}>
                    <input
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        placeholder="user/repo"
                        style={inputStyle}
                    />
                    <button onClick={handleCheckUpdate} disabled={checkingUpdate} style={{ ...btnStyle, width: 'auto' }}>
                        {checkingUpdate ? '...' : 'Check'}
                    </button>
                </div>
                {updateAvailable && (
                    <div style={{ marginTop: 12, color: '#00C853' }}>
                        Versão {remoteVersion} disponível!
                    </div>
                )}
            </div>
        </Card>
    </div>
);

const renderCloudView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
            <h3 style={{ marginTop: 0 }}>Backup</h3>
            <button onClick={handleExport} style={btnStyle}>Exportar JSON</button>
        </Card>
        <Card>
            <h3 style={{ marginTop: 0 }}>Restaurar</h3>
            <input
                type="file"
                accept=".json"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleImport}
            />
            <button onClick={() => fileInputRef.current?.click()} style={{ ...btnStyle, background: '#334155' }}>Importar JSON</button>
        </Card>
    </div>
);
  
  const getTitle = () => {
      switch(currentView) {
          case 'ACCOUNTS': return 'Contas Bancárias';
          case 'CARDS': return 'Cartões de Crédito';
          case 'SYSTEM': return 'Sistema';
          case 'CLOUD': return 'Dados e Backup';
          case 'NOTIFICATIONS': return 'Notificações';
          case 'GOALS': return 'Metas Financeiras';
          default: return 'Configurações';
      }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, gap: 12 }}>
        {currentView !== 'MAIN' && (
            <div onClick={() => setCurrentView('MAIN')} style={{cursor: 'pointer', padding: 4, borderRadius: '50%', background: '#334155'}}>
                <Icons.ChevronLeft />
            </div>
        )}
        <h2 style={{ fontSize: 24, margin: 0 }}>{getTitle()}</h2>
      </div>

      {currentView === 'MAIN' && renderMainView()}
      {currentView === 'ACCOUNTS' && renderAccountsView()}
      {currentView === 'CARDS' && renderCardsView()}
      {currentView === 'SYSTEM' && renderSystemView()}
      {currentView === 'CLOUD' && renderCloudView()}
      {currentView === 'NOTIFICATIONS' && renderNotificationsView()}
      {currentView === 'GOALS' && renderGoalsView()}

      {/* Modals for Card/Account are unchanged */}
      {isCardModalOpen && (
        <Modal title={editingCard ? "Editar Cartão" : "Novo Cartão"} onClose={() => setCardModalOpen(false)}>
            <form onSubmit={handleCardSubmit}>
              <Input label="Nome" value={cardForm.name} onChange={(e: any) => setCardForm({...cardForm, name: e.target.value})} />
              <Input label="Limite (R$)" type="number" value={cardForm.limit} onChange={(e: any) => setCardForm({...cardForm, limit: e.target.value})} />
              <div style={{display:'flex', gap: 12}}>
                <Input label="Dia Fechamento" type="number" value={cardForm.closing} onChange={(e: any) => setCardForm({...cardForm, closing: e.target.value})} />
                <Input label="Dia Vencimento" type="number" value={cardForm.due} onChange={(e: any) => setCardForm({...cardForm, due: e.target.value})} />
              </div>
              <button type="submit" style={btnStyle}>Salvar</button>
            </form>
        </Modal>
      )}

      {isAccountModalOpen && (
        <Modal title={editingAccount ? "Editar Conta" : "Nova Conta"} onClose={() => setAccountModalOpen(false)}>
            <form onSubmit={handleAccountSubmit}>
               <Input label="Nome do Banco" value={accountForm.name} onChange={(e: any) => setAccountForm({...accountForm, name: e.target.value})} />
               <div style={{marginBottom: 16}}>
                 <label style={{display:'block', fontSize:12, color:'#94a3b8', marginBottom:4}}>Tipo</label>
                 <select style={inputStyle} value={accountForm.type} onChange={(e: any) => setAccountForm({...accountForm, type: e.target.value})}>
                   <option value="CHECKING">Conta Corrente</option>
                   <option value="SAVINGS">Poupança/Investimento</option>
                   <option value="WALLET">Carteira Física</option>
                 </select>
               </div>
               <button type="submit" style={btnStyle}>Salvar</button>
            </form>
        </Modal>
      )}

      {isGoalModalOpen && (
            <Modal title="Nova Meta" onClose={() => setGoalModalOpen(false)}>
                <form onSubmit={handleGoalSubmit}>
                    <Input label="Nome da Meta" value={goalForm.title} onChange={(e: any) => setGoalForm({...goalForm, title: e.target.value})} placeholder="Ex: Viagem, Carro Novo" />
                    <Input label="Valor Alvo (R$)" type="number" value={goalForm.target} onChange={(e: any) => setGoalForm({...goalForm, target: e.target.value})} />
                    <Input label="Prazo" type="date" value={goalForm.date} onChange={(e: any) => setGoalForm({...goalForm, date: e.target.value})} />
                    <div style={{marginBottom: 16}}>
                        <label style={{display:'block', fontSize:12, color:'#94a3b8', marginBottom:4}}>Tipo de Objetivo</label>
                        <select style={inputStyle} value={goalForm.type} onChange={(e: any) => setGoalForm({...goalForm, type: e.target.value, linkedAccountId: ''})}>
                            <option value="NET_WORTH">Patrimônio Total</option>
                            <option value="INVESTMENTS">Total em Investimentos</option>
                            <option value="CRYPTO">Total em Cripto</option>
                            <option value="EMERGENCY_FUND">Reserva de Emergência (Poupança)</option>
                            <option value="CUSTOM">Reserva Manual</option>
                            <option value="ACCOUNT_TARGET">Saldo de Conta (Caixinha)</option>
                        </select>
                    </div>
                    {goalForm.type === 'ACCOUNT_TARGET' && (
                        <div style={{marginBottom: 16}}>
                            <label style={{display:'block', fontSize:12, color:'#94a3b8', marginBottom:4}}>Vincular Conta</label>
                            <select style={inputStyle} value={goalForm.linkedAccountId} onChange={(e: any) => setGoalForm({...goalForm, linkedAccountId: e.target.value})}>
                                <option value="">Selecione uma conta...</option>
                                {state.accounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <button type="submit" style={btnStyle}>Criar Meta</button>
                </form>
            </Modal>
      )}

      {selectedGoal && (
          <Modal title={selectedGoal.title} onClose={() => setSelectedGoal(null)}>
              <div style={{marginBottom: 24}}>
                  <p style={{color: '#94a3b8', margin: '0 0 8px 0'}}>Progresso Atual</p>
                  <div style={{fontSize: 24, fontWeight: 700, color: '#00C853'}}>{MoneyService.format(GoalService.calculateProgress(selectedGoal, state))}</div>
                  <p style={{fontSize: 12, opacity: 0.6}}>Meta: {MoneyService.format(selectedGoal.targetAmount)}</p>
                  {selectedGoal.linkedAccountId && (
                      <p style={{fontSize: 12, color: '#2979FF', marginTop: 8}}>
                          <Icons.Link /> Vinculado a {state.accounts.find(a => a.id === selectedGoal.linkedAccountId)?.name}
                      </p>
                  )}
              </div>
              
              {!selectedGoal.linkedAccountId && (
                  <div style={{borderTop: '1px solid #334155', paddingTop: 16}}>
                      <p style={{color: 'white', fontWeight: 600, marginBottom: 12}}>Movimentar Reserva</p>
                      <CurrencyInput label="Valor" value={operationAmount} onChange={setOperationAmount} />
                      <div style={{display: 'flex', gap: 12, marginTop: 12}}>
                          <button onClick={() => handleGoalOperation('DEPOSIT')} style={{...btnStyle, background: '#00C853'}}>Depositar</button>
                          <button onClick={() => handleGoalOperation('WITHDRAW')} style={{...btnStyle, background: '#FF5252'}}>Resgatar</button>
                      </div>
                  </div>
              )}
              {selectedGoal.linkedAccountId && (
                  <div style={{borderTop: '1px solid #334155', paddingTop: 16, opacity: 0.7}}>
                      <p style={{fontSize: 13}}>O progresso desta meta é atualizado automaticamente conforme o saldo da conta vinculada.</p>
                  </div>
              )}
          </Modal>
      )}
    </div>
  );
};

const InvestmentsScreen = ({ state, onConfirmDividend, onResetReinvestment }: { state: AppState, onConfirmDividend: (d: any) => void, onResetReinvestment: () => void }) => {
    const [dividends, setDividends] = useState<any[]>([]);

    useEffect(() => {
        MarketDataService.fetchUpcomingDividends().then(setDividends);
    }, []);

    const totalInvested = state.assets.reduce((acc, a) => acc + (a.quantity * a.currentPrice), 0);
    const allocation = state.assets.reduce((acc: any, asset) => {
        acc[asset.type] = (acc[asset.type] || 0) + (asset.quantity * asset.currentPrice);
        return acc;
    }, {});
    
    return (
        <div style={{ padding: 24 }}>
            <h2 style={{ marginBottom: 24 }}>Investimentos</h2>
            <Card style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, opacity: 0.6 }}>Patrimônio Investido</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: '#00C853' }}>{MoneyService.format(totalInvested)}</div>
            </Card>

            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
                {Object.keys(allocation).map(type => (
                    <Card key={type} style={{ minWidth: 120, padding: 16 }}>
                        <div style={{ fontSize: 12, opacity: 0.6 }}>{type}</div>
                        <div style={{ fontWeight: 600 }}>{MoneyService.format(allocation[type])}</div>
                    </Card>
                ))}
            </div>

            {dividends.length > 0 && (
                <>
                    <h3 style={{ fontSize: 18 }}>Proventos Previstos</h3>
                    <div style={{display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24}}>
                        {dividends.map(div => (
                            <Card key={div.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                <div>
                                    <div style={{fontWeight: 600}}>{div.ticker}</div>
                                    <div style={{fontSize: 12, opacity: 0.6}}>{div.type} • {new Date(div.paymentDate).toLocaleDateString()}</div>
                                </div>
                                <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                                    <div style={{fontWeight: 600, color: '#00C853'}}>{MoneyService.format(div.amount)}</div>
                                    <button onClick={() => onConfirmDividend({...div, asset: div.ticker})} style={actionBtnStyle}>Receber</button>
                                </div>
                            </Card>
                        ))}
                    </div>
                </>
            )}

            <h3 style={{ fontSize: 18 }}>Minha Carteira</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {state.assets.map(asset => {
                    const total = asset.quantity * asset.currentPrice;
                    const roi = asset.averagePrice > 0 ? ((asset.currentPrice - asset.averagePrice) / asset.averagePrice) * 100 : 0;
                    return (
                        <Card key={asset.id}>
                            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 8}}>
                                <div style={{fontWeight: 600}}>{asset.ticker}</div>
                                <div style={{fontWeight: 600}}>{MoneyService.format(total)}</div>
                            </div>
                            <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.7}}>
                                <div>{asset.quantity} un. • Médio: {MoneyService.format(asset.averagePrice)}</div>
                                <div style={{color: roi >= 0 ? '#00C853' : '#FF5252'}}>{roi > 0 ? '+' : ''}{roi.toFixed(1)}%</div>
                            </div>
                        </Card>
                    )
                })}
                {state.assets.length === 0 && <p style={{opacity: 0.5}}>Nenhum ativo.</p>}
            </div>
        </div>
    );
}

const VoiceListeningOverlay = ({ isListening, transcript }: { isListening: boolean, transcript: string }) => {
    if (!isListening) return null;
    
    const isIncome = /recebi|ganhei|depósito|salário/i.test(transcript);
    const isExpense = /gastei|paguei|comprei|saque/i.test(transcript);
    const borderColor = isIncome ? '#00C853' : (isExpense ? '#FF5252' : '#2979FF');

    return (
        <div style={{ 
            position: 'fixed', inset: 0, zIndex: 2000, 
            background: 'rgba(15, 23, 42, 0.9)', 
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', 
            color: 'white', backdropFilter: 'blur(5px)' 
        }}>
            <div style={{ 
                width: 100, height: 100, borderRadius: '50%', background: 'transparent', 
                border: `4px solid ${borderColor}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 32, 
                boxShadow: `0 0 40px ${borderColor}44`,
                animation: 'pulse 1.5s infinite'
            }}>
                <Icons.Mic />
            </div>
            <h3 style={{ fontSize: 24, margin: '0 0 16px 0', fontWeight: 600 }}>Ouvindo...</h3>
            <div style={{ 
                minHeight: 60, padding: '0 24px', textAlign: 'center', 
                fontSize: 18, fontWeight: 500, opacity: 0.9, lineHeight: 1.5,
                maxWidth: 400
            }}>
                {transcript || "Diga 'Gastei 50 reais no almoço'..."}
            </div>
            <style>{`
                @keyframes pulse {
                    0% { transform: scale(1); box-shadow: 0 0 0 0 ${borderColor}66; }
                    70% { transform: scale(1.1); box-shadow: 0 0 0 20px transparent; }
                    100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
                }
            `}</style>
        </div>
    );
}

const TransactionModal = ({ isOpen, onClose, state, initialData, onSave }: any) => {
  const [form, setForm] = useState({
    description: '', amount: 0, date: new Date().toISOString().split('T')[0],
    type: 'EXPENSE', category: 'Outros', accountId: '', cardId: '', installments: 1,
    // Novos campos
    assetTicker: '', assetQuantity: 0, investmentType: 'BUY',
    transferFrom: '', transferTo: ''
  });

  useEffect(() => {
    if (isOpen) {
        if (initialData) {
            setForm(prev => ({ ...prev, ...initialData }));
        } else {
            setForm({
                description: '', amount: 0, date: new Date().toISOString().split('T')[0],
                type: 'EXPENSE', category: 'Outros', accountId: state.accounts[0]?.id || '', cardId: '', installments: 1,
                assetTicker: '', assetQuantity: 0, investmentType: 'BUY',
                transferFrom: state.accounts[0]?.id || '', transferTo: ''
            });
        }
    }
  }, [initialData, isOpen, state.accounts]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let newTxns: Transaction[] = [];
    
    if (form.type === 'TRANSFER') {
        if (!form.transferFrom || !form.transferTo) {
            alert("Selecione as contas de origem e destino.");
            return;
        }
        if (form.transferFrom === form.transferTo) {
            alert("A conta de origem e destino não podem ser iguais.");
            return;
        }
        // Saída
        newTxns.push({
            id: `txn-out-${Date.now()}`,
            description: `Transferência para ${state.accounts.find((a:Account) => a.id === form.transferTo)?.name}`,
            amount: form.amount,
            date: form.date,
            type: 'EXPENSE',
            category: 'Pix/Transferência',
            accountId: form.transferFrom,
            isCleared: true
        });
        // Entrada
        newTxns.push({
            id: `txn-in-${Date.now()}`,
            description: `Recebido de ${state.accounts.find((a:Account) => a.id === form.transferFrom)?.name}`,
            amount: form.amount,
            date: form.date,
            type: 'INCOME',
            category: 'Pix/Transferência',
            accountId: form.transferTo,
            isCleared: true
        });
    } else if (form.type === 'INVESTMENT') {
        newTxns.push({
            id: `txn-${Date.now()}`,
            description: `${form.investmentType === 'BUY' ? 'Compra' : 'Venda'} ${form.assetTicker.toUpperCase()}`,
            amount: form.amount,
            date: form.date,
            type: 'INVESTMENT',
            category: 'Investimentos',
            investmentType: form.investmentType as any,
            accountId: form.accountId,
            assetTicker: form.assetTicker.toUpperCase(),
            assetQuantity: Number(form.assetQuantity),
            assetPrice: Math.round(form.amount / (Number(form.assetQuantity) || 1)),
            isCleared: true
        });
    } else {
        // Expense / Income logic
        const isCard = !!form.cardId;
        if (isCard && form.installments > 1 && form.type === 'EXPENSE') {
            const card = state.creditCards.find((c: CreditCard) => c.id === form.cardId);
            if (card) {
                newTxns = CreditCardService.generateInstallmentPlan(
                    card, form.amount, form.installments, form.description, form.category, new Date(form.date)
                );
            }
        } else {
            newTxns.push({
                id: `txn-${Date.now()}`,
                description: form.description,
                amount: form.amount,
                date: form.date,
                type: form.type as any,
                category: form.category,
                accountId: form.accountId || undefined,
                cardId: form.cardId || undefined,
                isCleared: !isCard
            });
        }
    }
    
    onSave(newTxns);
    onClose();
  };

  const getTypeColor = (t: string) => {
      if(t === 'EXPENSE') return '#FF5252';
      if(t === 'INCOME') return '#00C853';
      if(t === 'INVESTMENT') return '#FFD700';
      if(t === 'TRANSFER') return '#2979FF';
      return '#334155';
  }

  return (
    <Modal title="Nova Transação" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4}}>
            {['EXPENSE', 'INCOME', 'INVESTMENT', 'TRANSFER'].map(t => (
                <button 
                    key={t}
                    type="button" 
                    onClick={() => setForm({...form, type: t as any})} 
                    style={{
                        padding: '10px 12px', borderRadius: 8, border: 'none', 
                        background: form.type === t ? getTypeColor(t) : '#334155', 
                        color: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                        whiteSpace: 'nowrap', flex: 1
                    }}
                >
                    {t === 'EXPENSE' ? 'Despesa' : t === 'INCOME' ? 'Receita' : t === 'INVESTMENT' ? 'Investimento' : 'Transferência'}
                </button>
            ))}
        </div>

        <CurrencyInput label="Valor" value={form.amount} onChange={(val) => setForm({...form, amount: val})} autoFocus />
        
        {form.type !== 'TRANSFER' && (
            <Input label="Descrição" value={form.description} onChange={(e: any) => setForm({...form, description: e.target.value})} placeholder="Ex: Almoço, Salário" />
        )}
        
        <div style={{display: 'flex', gap: 12}}>
            <Input label="Data" type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})} />
        </div>

        {/* --- TRANSFER UI --- */}
        {form.type === 'TRANSFER' && (
            <>
                <div style={{marginBottom: 16}}>
                    <label style={{display:'block', fontSize:12, color:'#94a3b8', marginBottom:4}}>De (Origem)</label>
                    <select style={inputStyle} value={form.transferFrom} onChange={(e: any) => setForm({...form, transferFrom: e.target.value})}>
                        <option value="">Selecione...</option>
                        {state.accounts.map((a: Account) => <option key={a.id} value={a.id}>{a.name} ({MoneyService.format(a.balance)})</option>)}
                    </select>
                </div>
                <div style={{marginBottom: 16}}>
                    <label style={{display:'block', fontSize:12, color:'#94a3b8', marginBottom:4}}>Para (Destino)</label>
                    <select style={inputStyle} value={form.transferTo} onChange={(e: any) => setForm({...form, transferTo: e.target.value})}>
                        <option value="">Selecione...</option>
                        {state.accounts.map((a: Account) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                </div>
            </>
        )}

        {/* --- INVESTMENT UI --- */}
        {form.type === 'INVESTMENT' && (
            <>
                <div style={{display: 'flex', gap: 12, marginBottom: 16}}>
                    <button type="button" onClick={() => setForm({...form, investmentType: 'BUY'})} style={{flex: 1, padding: 10, background: form.investmentType === 'BUY' ? '#00C853' : '#334155', border: 'none', borderRadius: 8, color: 'white'}}>Comprar</button>
                    <button type="button" onClick={() => setForm({...form, investmentType: 'SELL'})} style={{flex: 1, padding: 10, background: form.investmentType === 'SELL' ? '#00C853' : '#334155', border: 'none', borderRadius: 8, color: 'white'}}>Vender</button>
                </div>
                <div style={{display:'flex', gap: 12}}>
                    <Input label="Ticker (Código)" value={form.assetTicker} onChange={(e: any) => setForm({...form, assetTicker: e.target.value})} placeholder="Ex: PETR4" />
                    <Input label="Quantidade" type="number" value={form.assetQuantity} onChange={(e: any) => setForm({...form, assetQuantity: e.target.value})} />
                </div>
                <div style={{marginBottom: 16}}>
                    <label style={{display:'block', fontSize:12, color:'#94a3b8', marginBottom:4}}>Conta Corretora</label>
                    <select style={inputStyle} value={form.accountId} onChange={(e: any) => setForm({...form, accountId: e.target.value})}>
                        <option value="">Selecione...</option>
                        {state.accounts.map((a: Account) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                </div>
            </>
        )}

        {/* --- STANDARD EXPENSE/INCOME UI --- */}
        {(form.type === 'EXPENSE' || form.type === 'INCOME') && (
            <>
                <div style={{marginBottom: 16}}>
                    <label style={{display:'block', fontSize:12, color:'#94a3b8', marginBottom:4}}>Categoria</label>
                    <select style={inputStyle} value={form.category} onChange={(e: any) => setForm({...form, category: e.target.value})}>
                        {(form.type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>

                <div style={{marginBottom: 16}}>
                    <label style={{display:'block', fontSize:12, color:'#94a3b8', marginBottom:4}}>{form.type === 'INCOME' ? 'Conta Destino' : 'Meio de Pagamento'}</label>
                    <select style={inputStyle} value={form.cardId || form.accountId} onChange={(e: any) => {
                        const val = e.target.value;
                        if (form.type === 'INCOME') {
                             setForm({...form, accountId: val});
                        } else {
                            const isCard = state.creditCards.some((c: CreditCard) => c.id === val);
                            if(isCard) setForm({...form, cardId: val, accountId: ''});
                            else setForm({...form, accountId: val, cardId: ''});
                        }
                    }}>
                        <option value="">Selecione...</option>
                        <optgroup label="Contas">
                            {state.accounts.map((a: Account) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </optgroup>
                        {form.type === 'EXPENSE' && (
                            <optgroup label="Cartões">
                                {state.creditCards.map((c: CreditCard) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </optgroup>
                        )}
                    </select>
                </div>

                {!!form.cardId && form.type === 'EXPENSE' && (
                    <Input label="Parcelas" type="number" min="1" max="24" value={form.installments} onChange={(e: any) => setForm({...form, installments: parseInt(e.target.value)})} />
                )}
            </>
        )}

        <button type="submit" style={btnStyle}>Salvar</button>
      </form>
    </Modal>
  );
};

const App = () => {
  const [activeTab, setActiveTab] = useState<'HOME' | 'CARDS' | 'BANKS' | 'INVESTMENTS' | 'SETTINGS'>('HOME');
  const [isModalOpen, setModalOpen] = useState(false);
  const [locked, setLocked] = useState(true);

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [voiceDraftData, setVoiceDraftData] = useState<any>(null);
  const [flashFeedback, setFlashFeedback] = useState<'NONE' | 'SUCCESS' | 'EXPENSE'>('NONE');
  
  const [longPressProgress, setLongPressProgress] = useState(0);
  const recognitionRef = useRef<any>(null);
  const progressAnimationRef = useRef<any>(null);
  const PRESS_DURATION = 5000; 

  const initialState: AppState = {
    accounts: [],
    creditCards: [],
    transactions: [],
    assets: [],
    goals: [],
    notifications: [],
    userProfile: { level: 1, xp: 0, achievements: [] },
    processedCorporateActionIds: [],
    lastReinvestmentResetDate: new Date('2024-01-01').toISOString(),
    settings: { githubRepo: '' }
  };

  const [state, setState] = useState<AppState>(initialState);

  useEffect(() => {
     if ('Notification' in window && Notification.permission === 'default') {
         Notification.requestPermission();
     }
  }, []);

  const unreadCount = useMemo(() => state.notifications.filter(n => !n.read).length, [state.notifications]);

  useEffect(() => {
    const saved = localStorage.getItem('zenith_superapp_v3_br');
    if (saved) {
        try {
            const loaded = JSON.parse(saved);
            setState(prev => ({
                ...prev, 
                ...loaded, 
                goals: loaded.goals || [], 
                processedCorporateActionIds: loaded.processedCorporateActionIds || [],
                lastReinvestmentResetDate: loaded.lastReinvestmentResetDate || prev.lastReinvestmentResetDate,
                settings: loaded.settings || prev.settings
            }));
        } catch (e) {
            console.error("Error loading state", e);
        }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('zenith_superapp_v3_br', JSON.stringify(state));
  }, [state]);

  useEffect(() => {
      const checkSystemHealth = async () => {
          const alerts: NotificationItem[] = [];
          const today = new Date();
          const todayStr = today.toISOString().split('T')[0];
          
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toISOString().split('T')[0];

          const pushAlert = (alert: NotificationItem) => {
             alerts.push(alert);
             sendSystemNotification(alert.title, alert.message);
          };

          state.accounts.forEach(acc => {
              if (acc.balance < 0) {
                  const id = `alert-balance-neg-${acc.id}-${todayStr}`;
                  if (!state.notifications.find(n => n.id === id)) {
                      pushAlert({
                          id, title: 'Conta no Vermelho', message: `A conta ${acc.name} está negativa em ${MoneyService.format(acc.balance)}.`,
                          date: today.toISOString(), type: 'WARNING', read: false
                      });
                  }
              }
          });

          if (state.assets.length > 0) {
            const divs = await MarketDataService.fetchUpcomingDividends();
            divs.forEach(div => {
                if (div.paymentDate === tomorrowStr) {
                    const myAsset = state.assets.find(a => a.ticker === div.ticker);
                    if (myAsset && myAsset.quantity > 0) {
                        const totalAmount = myAsset.quantity * div.amountPerShare;
                        const id = `alert-div-${div.ticker}-${tomorrowStr}`;
                        
                        if (!state.notifications.find(n => n.id === id) && !(state.processedCorporateActionIds || []).includes(div.id)) {
                            pushAlert({
                                id, title: 'Entrada de Proventos', message: `${div.ticker} paga ${MoneyService.format(totalAmount)} amanhã!`,
                                date: today.toISOString(), type: 'SUCCESS', read: false
                            });
                        }
                    }
                }
            });
          }

          if (alerts.length > 0) {
              setState(prev => ({ ...prev, notifications: [...alerts, ...prev.notifications] }));
          }
      };
      
      checkSystemHealth();
  }, [state.transactions, state.accounts, state.creditCards, state.assets, state.processedCorporateActionIds]); 

  useEffect(() => {
    const updateMarketData = async () => {
      if (state.assets.length === 0) return;
      const updatedAssets = await Promise.all(state.assets.map(async (asset) => {
        const newPrice = await MarketDataService.fetchPrice(asset.ticker);
        return { ...asset, currentPrice: newPrice };
      }));
      setState(prev => ({...prev, assets: updatedAssets}));
    };
    const interval = setInterval(updateMarketData, 30000); 
    updateMarketData(); 
    return () => clearInterval(interval);
  }, [state.assets.length]); 

  const handleImportData = (newState: AppState) => { setState(newState); }
  const handleUpdateSettings = (newSettings: AppSettings) => { setState(prev => ({...prev, settings: newSettings})); }
  
  const handleMarkAsRead = (id: string) => {
      setState(prev => ({
          ...prev,
          notifications: prev.notifications.map(n => n.id === id ? { ...n, read: true } : n)
      }));
  }

  const handleSaveGoal = (goal: FinancialGoal) => {
      setState(prev => ({ ...prev, goals: [...prev.goals, goal] }));
  }
  const handleDeleteGoal = (id: string) => {
      if(window.confirm("Excluir meta?")) {
        setState(prev => ({ ...prev, goals: prev.goals.filter(g => g.id !== id) }));
      }
  }
  
  const handleUpdateGoalAmount = (id: string, amount: Cents) => {
      setState(prev => ({
          ...prev,
          goals: prev.goals.map(g => {
              if (g.id !== id) return g;
              const currentSaved = g.savedAmount || 0;
              const newSaved = currentSaved + amount;
              return { ...g, savedAmount: Math.max(0, newSaved) };
          })
      }));
  }

  const handleConfirmDividend = (dividend: {id: string, asset: string, amount: number, type: string}) => {
      if(state.accounts.length === 0) {
          alert('Adicione uma conta bancária primeiro para receber os proventos.');
          return;
      }
      const accountId = state.accounts[0].id;
      const confirm = window.confirm(`Confirmar recebimento de ${MoneyService.format(dividend.amount)} na conta ${state.accounts[0].name}?`);
      if(!confirm) return;

      const newTxn: Transaction = {
          id: `div-txn-${Date.now()}`, description: `${dividend.type} - ${dividend.asset}`, amount: dividend.amount, date: new Date().toISOString(),
          type: 'INCOME', category: 'Rendimentos', accountId: accountId, isCleared: true
      };

      setState(prev => {
          const updatedAccounts = prev.accounts.map(acc => acc.id === accountId ? { ...acc, balance: acc.balance + dividend.amount } : acc);
          return {
              ...prev, accounts: updatedAccounts, transactions: [newTxn, ...prev.transactions], processedCorporateActionIds: [...(prev.processedCorporateActionIds || []), dividend.id]
          };
      });
  };

  const handleResetReinvestment = () => { setState(prev => ({ ...prev, lastReinvestmentResetDate: new Date().toISOString() })); }

  const handleDeleteTransaction = (id: string) => {
    setState(prev => {
        const txn = prev.transactions.find(t => t.id === id);
        if(!txn) return prev;
        
        const updatedAccounts = prev.accounts.map(acc => {
            if (acc.id !== txn.accountId) return acc;
            let newBalance = acc.balance;
            if (txn.type === 'INCOME') newBalance -= txn.amount;
            else if (txn.type === 'EXPENSE') newBalance += txn.amount;
            else if (txn.type === 'INVESTMENT') {
                if (txn.investmentType === 'SELL') newBalance -= txn.amount;
                else newBalance += txn.amount;
            }
            return { ...acc, balance: newBalance };
        });

        let updatedAssets = [...prev.assets];
        if (txn.type === 'INVESTMENT' && txn.assetTicker) {
            const assetIndex = updatedAssets.findIndex(a => a.ticker === txn.assetTicker);
            if (assetIndex >= 0) {
                const asset = updatedAssets[assetIndex];
                const qty = txn.assetQuantity || 0;
                const isBuy = txn.investmentType === 'BUY' || !txn.investmentType;
                if (isBuy) asset.quantity -= qty; else asset.quantity += qty;
                if (asset.quantity < 0) asset.quantity = 0;
                updatedAssets[assetIndex] = {...asset};
            }
        }
        return { ...prev, accounts: updatedAccounts, assets: updatedAssets, transactions: prev.transactions.filter(t => t.id !== id) };
    });
  }

  const handleNewTransactions = (newTxns: Transaction[]) => {
    setState(prev => {
      const updatedAccounts = prev.accounts.map(acc => {
        const allTxns = [...newTxns, ...prev.transactions];
        const relevantTxns = allTxns.filter(t => t.accountId === acc.id);
        const totalBalance = relevantTxns.reduce((sum, t) => {
          if (t.type === 'INCOME') return sum + t.amount;
          if (t.type === 'INVESTMENT') return t.investmentType === 'SELL' ? sum + t.amount : sum - t.amount;
          return sum - t.amount; 
        }, 0);
        return { ...acc, balance: totalBalance };
      });

      let updatedAssets = [...prev.assets];
      newTxns.forEach(t => {
        if (t.type === 'INVESTMENT' && t.assetTicker) {
          const existing = updatedAssets.find(a => a.ticker === t.assetTicker);
          const isBuy = t.investmentType === 'BUY' || !t.investmentType;
          const qty = t.assetQuantity || 0;

          if (existing) {
             let newQty = isBuy ? existing.quantity + qty : existing.quantity - qty;
             if (newQty < 0) newQty = 0; 
             if (newQty === 0) updatedAssets = updatedAssets.filter(a => a.ticker !== t.assetTicker);
             else {
                 let newAvg = existing.averagePrice;
                 if (isBuy) {
                    const totalCost = (existing.quantity * existing.averagePrice) + t.amount;
                    newAvg = totalCost / newQty;
                 }
                 updatedAssets = updatedAssets.map(a => a.id === existing.id ? { ...a, quantity: newQty, averagePrice: Math.round(newAvg) } : a);
             }
          } else if (isBuy) {
             updatedAssets.push({
               id: `asset-${Date.now()}`, ticker: t.assetTicker!, quantity: qty, averagePrice: t.assetPrice || 0, currentPrice: t.assetPrice || 0, type: 'STOCK'
             });
          }
        }
      });

      return { ...prev, accounts: updatedAccounts, assets: updatedAssets, transactions: [...newTxns, ...prev.transactions] };
    });
  };

  const handleSaveCard = (card: CreditCard) => {
    setState(prev => {
      const exists = prev.creditCards.find(c => c.id === card.id);
      if (exists) return { ...prev, creditCards: prev.creditCards.map(c => c.id === card.id ? card : c) };
      return { ...prev, creditCards: [...prev.creditCards, card] };
    });
  };

  const handleDeleteCard = (id: string) => {
    if (window.confirm("Tem certeza que deseja excluir este cartão?")) setState(prev => ({ ...prev, creditCards: prev.creditCards.filter(c => c.id !== id) }));
  };

  const handleSaveAccount = (account: Account) => {
    setState(prev => {
      const exists = prev.accounts.find(a => a.id === account.id);
      if (exists) return { ...prev, accounts: prev.accounts.map(a => a.id === account.id ? account : a) };
      return { ...prev, accounts: [...prev.accounts, account] };
    });
  };

  const handleDeleteAccount = (id: string) => {
    if (window.confirm("Tem certeza que deseja excluir esta conta?")) setState(prev => ({ ...prev, accounts: prev.accounts.filter(a => a.id !== id) }));
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Seu navegador não suporta comando de voz.");
        return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = true; 

    recognition.onstart = () => {
        setIsListening(true);
        setTranscript('');
        SoundService.play('START');
        if (navigator.vibrate) navigator.vibrate(100);
    };

    recognition.onend = () => setIsListening(false);
    
    recognition.onresult = async (event: any) => {
        const currentTranscript = Array.from(event.results)
            .map((result: any) => result[0].transcript)
            .join('');
        setTranscript(currentTranscript);

        if (event.results[0].isFinal) {
            const draft = await AIService.parseTransaction(currentTranscript, state);
            if (draft) {
                setVoiceDraftData(draft);
                SoundService.play('SUCCESS');
                if (draft.type === 'INCOME') setFlashFeedback('SUCCESS'); else setFlashFeedback('EXPENSE');
                setTimeout(() => { setFlashFeedback('NONE'); setModalOpen(true); }, 500); 
            } else {
                SoundService.play('ERROR');
                if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            }
        }
    };
    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopListening = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
  };
  
  const handleButtonDown = () => {
      const startTime = Date.now();
      const animate = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min((elapsed / PRESS_DURATION) * 100, 100);
          setLongPressProgress(progress);
          
          if (progress < 100) {
              progressAnimationRef.current = requestAnimationFrame(animate);
          } else {
              setLongPressProgress(0); 
              startListening();
          }
      };
      progressAnimationRef.current = requestAnimationFrame(animate);
  }
  
  const handleButtonUp = () => {
      cancelAnimationFrame(progressAnimationRef.current);
      if (longPressProgress > 0 && longPressProgress < 100) {
          if (!isListening) setModalOpen(true);
      }
      setLongPressProgress(0);
  }

  if (locked) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: 'white', flexDirection: 'column' }}>
        <Icons.Lock />
        <h3 style={{ marginTop: 20 }}>Acesso Seguro</h3>
        <button onClick={() => setLocked(false)} style={{ marginTop: 20, padding: '12px 32px', background: '#2979FF', border: 'none', borderRadius: 8, color: 'white', cursor: 'pointer' }}>Desbloquear App</button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ paddingBottom: 100 }}>
        {activeTab === 'HOME' && <HomeScreen state={state} onOpenSettings={() => setActiveTab('SETTINGS')} unreadCount={unreadCount} />}
        {activeTab === 'CARDS' && <CardsScreen state={state} onDeleteTransaction={handleDeleteTransaction} />}
        {activeTab === 'BANKS' && <BankScreen state={state} onDeleteTransaction={handleDeleteTransaction} />}
        {activeTab === 'INVESTMENTS' && <InvestmentsScreen state={state} onConfirmDividend={handleConfirmDividend} onResetReinvestment={handleResetReinvestment} />}
        {activeTab === 'SETTINGS' && <SettingsScreen 
            state={state} 
            onSaveCard={handleSaveCard} 
            onDeleteCard={handleDeleteCard}
            onSaveAccount={handleSaveAccount}
            onDeleteAccount={handleDeleteAccount}
            onImportData={handleImportData}
            onUpdateSettings={handleUpdateSettings}
            onMarkAsRead={handleMarkAsRead}
            onSaveGoal={handleSaveGoal}
            onDeleteGoal={handleDeleteGoal}
            onUpdateGoalAmount={handleUpdateGoalAmount}
        />}
      </div>

      <TransactionModal 
        isOpen={isModalOpen} 
        onClose={() => { setModalOpen(false); setVoiceDraftData(null); }} 
        state={state}
        initialData={voiceDraftData}
        onSave={handleNewTransactions}
      />

      <VoiceListeningOverlay isListening={isListening} transcript={transcript} />
      
      <div style={{
          position: 'fixed', inset: 0, zIndex: 998, pointerEvents: 'none',
          background: flashFeedback === 'SUCCESS' ? '#00C853' : (flashFeedback === 'EXPENSE' ? '#FFAB00' : 'transparent'),
          opacity: flashFeedback === 'NONE' ? 0 : 0.3,
          transition: 'opacity 0.3s ease-out'
      }} />

      <nav 
        style={{ 
            position: 'fixed', bottom: 0, width: '100%', background: '#1e293b', borderTop: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '12px 0', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', zIndex: 40
        }}
      >
        <button onClick={() => setActiveTab('HOME')} style={{ background: 'none', border: 'none', color: activeTab === 'HOME' ? '#2979FF' : '#64748b', padding: 8, cursor: 'pointer' }}><Icons.Home /></button>
        <button onClick={() => setActiveTab('INVESTMENTS')} style={{ background: 'none', border: 'none', color: activeTab === 'INVESTMENTS' ? '#2979FF' : '#64748b', padding: 8, cursor: 'pointer' }}><Icons.TrendingUp /></button>
        
        <div style={{position: 'relative', width: 72, height: 72, marginTop: -40, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            {longPressProgress > 0 && (
                <svg width="72" height="72" style={{position: 'absolute', transform: 'rotate(-90deg)', pointerEvents: 'none'}}>
                    <circle cx="36" cy="36" r="34" stroke="#0f172a" strokeWidth="4" fill="transparent" />
                    <circle cx="36" cy="36" r="34" stroke="#FF5252" strokeWidth="4" fill="transparent" 
                        strokeDasharray={213} 
                        strokeDashoffset={213 - (213 * longPressProgress) / 100}
                        strokeLinecap="round"
                    />
                </svg>
            )}
            
            <button 
                onMouseDown={handleButtonDown}
                onMouseUp={handleButtonUp}
                onMouseLeave={handleButtonUp}
                onTouchStart={(e) => { e.preventDefault(); handleButtonDown(); }}
                onTouchEnd={(e) => { e.preventDefault(); handleButtonUp(); }}
                style={{
                    width: 64, height: 64, borderRadius: '50%', background: isListening ? '#FF5252' : '#2979FF',
                    border: '6px solid #0f172a', 
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 8px 24px rgba(41, 121, 255, 0.5)', 
                    cursor: 'pointer', outline: 'none',
                    transition: 'transform 0.1s', transform: longPressProgress > 0 ? 'scale(0.95)' : 'scale(1)'
                }}>
                {isListening ? <Icons.Mic /> : <Icons.Plus />}
            </button>
        </div>

        <button onClick={() => setActiveTab('CARDS')} style={{ background: 'none', border: 'none', color: activeTab === 'CARDS' ? '#2979FF' : '#64748b', padding: 8, cursor: 'pointer' }}><Icons.Card /></button>
        <button onClick={() => setActiveTab('BANKS')} style={{ background: 'none', border: 'none', color: activeTab === 'BANKS' ? '#2979FF' : '#64748b', padding: 8, cursor: 'pointer' }}><Icons.Bank /></button>
      </nav>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}