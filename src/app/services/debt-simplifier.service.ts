import { Injectable } from '@angular/core';
import { Expense, Balance, Debt, Settlement } from '../models/conto-acapo.models';

@Injectable({
  providedIn: 'root',
})
export class DebtSimplifierService {
  /**
   * Calcola quanto spetta a ciascuno di una spesa, in CENTESIMI interi.
   * La somma delle quote è sempre esattamente uguale al totale della spesa.
   *
   * - equal:   tutti i partecipanti hanno peso 1
   * - exact:   il peso è l'importo in euro
   * - percent: il peso è la percentuale
   * - shares:  il peso è il numero di quote
   *
   * I centesimi che avanzano vanno a chi ha il "resto" più alto; a parità, la scelta
   * dipende solo dall'ID della spesa, quindi NON dall'ordine dei membri nel gruppo.
   * Per ogni spesa il risultato è quindi sempre lo stesso su tutti i dispositivi.
   */
  computeShares(expense: Expense, memberIds: string[]): Map<string, number> {
    const total = Math.round(expense.amount * 100);

    let participants = (expense.splitBetweenUserIds || []).filter((id) => memberIds.includes(id));
    if (participants.length === 0) participants = [...memberIds];
    participants = [...participants].sort(); // ordine stabile, indipendente dai membri

    const mode = expense.splitMode || 'equal';
    const values = expense.splitValues || {};

    const entries = participants.map((id) => ({
      id,
      w: mode === 'equal' ? 1 : Math.max(0, Number(values[id]) || 0),
    }));

    return this.allocate(total, entries, this.hash(expense.id || ''));
  }

  /** Divide `totalCents` in proporzione ai pesi (metodo del resto più alto). */
  private allocate(
    totalCents: number,
    entries: { id: string; w: number }[],
    seed: number,
  ): Map<string, number> {
    const result = new Map<string, number>();
    const n = entries.length;
    if (n === 0) return result;

    let sumW = entries.reduce((s, e) => s + e.w, 0);
    if (sumW <= 0) {
      entries = entries.map((e) => ({ id: e.id, w: 1 }));
      sumW = n;
    }

    const parts = entries.map((e, i) => {
      const exact = (totalCents * e.w) / sumW;
      const base = Math.floor(exact + 1e-9);
      return { id: e.id, base, frac: exact - base, order: (i + seed) % n, w: e.w };
    });

    let rest = totalCents - parts.reduce((s, p) => s + p.base, 0);

    // Assegna i centesimi mancanti a chi ha il resto più alto
    const byRemainder = [...parts].sort((a, b) => b.frac - a.frac || a.order - b.order);
    for (let k = 0; rest > 0 && k < byRemainder.length; k++, rest--) {
      byRemainder[k].base += 1;
    }
    // Protezione da errori di virgola mobile (non dovrebbe mai servire)
    const byLowest = [...parts].sort((a, b) => a.frac - b.frac);
    for (let k = 0; rest < 0 && k < byLowest.length; k++) {
      if (byLowest[k].base > 0) {
        byLowest[k].base -= 1;
        rest++;
      }
    }

    parts.forEach((p) => result.set(p.id, p.base));
    return result;
  }

  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  /**
   * Calcola i bilanci netti di ciascun utente (spese + pagamenti già effettuati).
   * Lavora in centesimi interi: la somma di tutti i saldi è sempre esattamente zero.
   */
  calculateBalances(
    expenses: Expense[],
    memberIds: string[],
    settlements: Settlement[] = [],
  ): Balance[] {
    const cents = new Map<string, number>();
    memberIds.forEach((id) => cents.set(id, 0));

    expenses.forEach((expense) => {
      if (memberIds.length === 0) return;
      const total = Math.round(expense.amount * 100);
      const shares = this.computeShares(expense, memberIds);

      // Chi ha pagato incrementa il suo credito (solo se fa ancora parte del gruppo)
      if (cents.has(expense.paidByUserId)) {
        cents.set(expense.paidByUserId, cents.get(expense.paidByUserId)! + total);
      }

      // Chi beneficia della spesa decrementa il suo bilancio
      shares.forEach((quota, userId) => {
        if (cents.has(userId)) {
          cents.set(userId, cents.get(userId)! - quota);
        }
      });
    });

    // pagamenti già effettuati: il debitore sale verso 0, il creditore scende verso 0
    settlements.forEach((s) => {
      if (!cents.has(s.fromUserId) || !cents.has(s.toUserId)) return;
      const c = Math.round(s.amount * 100);
      cents.set(s.fromUserId, cents.get(s.fromUserId)! + c);
      cents.set(s.toUserId, cents.get(s.toUserId)! - c);
    });

    return Array.from(cents.entries()).map(([userId, c]) => ({
      userId,
      amount: c / 100,
    }));
  }

  /**
   * Calcola i debiti diretti (spesa per spesa) tra ciascuna coppia di partecipanti.
   * Usa le stesse quote in centesimi dei saldi, quindi i totali coincidono sempre al centesimo.
   */
  calculateDirectDebts(
    expenses: Expense[],
    memberIds: string[],
    settlements: Settlement[] = [],
  ): Debt[] {
    // owed.get(A).get(B) = centesimi che B deve ad A
    const owed = new Map<string, Map<string, number>>();
    memberIds.forEach((m1) => {
      owed.set(m1, new Map<string, number>());
      memberIds.forEach((m2) => {
        if (m1 !== m2) owed.get(m1)!.set(m2, 0);
      });
    });

    expenses.forEach((expense) => {
      const payerId = expense.paidByUserId;
      if (!memberIds.includes(payerId)) return;

      this.computeShares(expense, memberIds).forEach((quota, debtorId) => {
        if (debtorId !== payerId && memberIds.includes(debtorId)) {
          const current = owed.get(payerId)!.get(debtorId) || 0;
          owed.get(payerId)!.set(debtorId, current + quota);
        }
      });
    });

    // pagamenti già effettuati: "from" deve meno a "to" di quanto prima
    settlements.forEach((s) => {
      if (!memberIds.includes(s.fromUserId) || !memberIds.includes(s.toUserId)) return;
      const current = owed.get(s.toUserId)?.get(s.fromUserId) || 0;
      owed.get(s.toUserId)?.set(s.fromUserId, current - Math.round(s.amount * 100));
    });

    const directDebts: Debt[] = [];

    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        const u1 = memberIds[i];
        const u2 = memberIds[j];

        const diff = (owed.get(u1)?.get(u2) || 0) - (owed.get(u2)?.get(u1) || 0);

        if (diff > 0) {
          directDebts.push({ fromUserId: u2, toUserId: u1, amount: diff / 100 });
        } else if (diff < 0) {
          directDebts.push({ fromUserId: u1, toUserId: u2, amount: -diff / 100 });
        }
      }
    }

    return directDebts.sort((a, b) => b.amount - a.amount);
  }

  /**
   * Semplifica i debiti incrociati minimizzando le transazioni necessarie.
   * Lavora in centesimi interi, partendo dai debitori e creditori più grandi.
   */
  simplifyDebts(balances: Balance[]): Debt[] {
    const debtors: { userId: string; cents: number }[] = [];
    const creditors: { userId: string; cents: number }[] = [];

    balances.forEach((b) => {
      const c = Math.round(b.amount * 100);
      if (c < 0) debtors.push({ userId: b.userId, cents: -c });
      else if (c > 0) creditors.push({ userId: b.userId, cents: c });
    });

    debtors.sort((a, b) => b.cents - a.cents);
    creditors.sort((a, b) => b.cents - a.cents);

    const debts: Debt[] = [];
    let i = 0;
    let j = 0;

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const payment = Math.min(debtor.cents, creditor.cents);

      debts.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amount: payment / 100,
      });

      debtor.cents -= payment;
      creditor.cents -= payment;

      if (debtor.cents === 0) i++;
      if (creditor.cents === 0) j++;
    }

    return debts;
  }
}

