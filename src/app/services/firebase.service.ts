import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  Firestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  updateDoc,
  Unsubscribe,
} from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { Group, Expense, User, Settlement } from '../models/conto-acapo.models';

@Injectable({
  providedIn: 'root',
})
export class FirebaseService {
  private readonly MY_GROUPS_KEY = 'conto_acapo_my_group_ids';

  private app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
  public db: Firestore = getFirestore(this.app);

  // --- GESTIONE "I MIEI GRUPPI" (Privacy Locale) ---
  getMyGroupIds(): string[] {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(this.MY_GROUPS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  rememberGroupId(groupId: string): void {
    if (typeof localStorage === 'undefined' || !groupId) return;
    const ids = this.getMyGroupIds();
    if (!ids.includes(groupId)) {
      ids.unshift(groupId);
      localStorage.setItem(this.MY_GROUPS_KEY, JSON.stringify(ids));
    }
  }

  forgetGroupId(groupId: string): void {
    if (typeof localStorage === 'undefined' || !groupId) return;
    const ids = this.getMyGroupIds().filter((id) => id !== groupId);
    localStorage.setItem(this.MY_GROUPS_KEY, JSON.stringify(ids));
  }

  // --- ASCOLTO SOLO DEI "MIEI GRUPPI" ---
  // Scarica SOLO i gruppi a cui questo dispositivo ha accesso tramite link o creazione
  subscribeMyGroups(callback: (groups: Group[]) => void): Unsubscribe {
    const ids = this.getMyGroupIds();
    if (ids.length === 0) {
      callback([]);
      return () => {};
    }

    const groupMap = new Map<string, Group>();
    const unsubs: Unsubscribe[] = [];

    ids.forEach((id) => {
      const docRef = doc(this.db, 'groups', id);
      const unsub = onSnapshot(
        docRef,
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            groupMap.set(id, {
              id: docSnap.id,
              name: data['name'] || '',
              description: data['description'] || undefined,
              members: data['members'] || [],
              createdAt: data['createdAt'] ? new Date(data['createdAt']) : new Date(),
            });
          } else {
            // Il gruppo è stato eliminato
            groupMap.delete(id);
            this.forgetGroupId(id);
          }
          const list = Array.from(groupMap.values());
          list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          callback(list);
        },
        (error) => {
          console.error(`Errore caricamento gruppo ${id}:`, error);
        },
      );
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }

  // Ascolta in tempo reale un singolo gruppo tramite il suo ID privato
  subscribeGroup(groupId: string, callback: (group: Group | null) => void): Unsubscribe {
    const groupDocRef = doc(this.db, 'groups', groupId);
    return onSnapshot(
      groupDocRef,
      (docSnap) => {
        if (!docSnap.exists()) {
          callback(null);
          return;
        }
        const data = docSnap.data();
        const group: Group = {
          id: docSnap.id,
          name: data['name'] || '',
          description: data['description'] || undefined,
          members: data['members'] || [],
          createdAt: data['createdAt'] ? new Date(data['createdAt']) : new Date(),
        };
        // Lo memorizza automaticamente nei gruppi dell'utente
        this.rememberGroupId(groupId);
        callback(group);
      },
      (error) => {
        console.error('Errore Firestore subscribeGroup:', error);
      },
    );
  }

  async createGroup(name: string, memberNames: string[], description?: string): Promise<Group> {
    const members: User[] = memberNames
      .filter((n) => n.trim().length > 0)
      .map((mName) => ({
        id: 'u_' + Math.random().toString(36).substring(2, 9),
        name: mName.trim(),
      }));

    // Genera un ID segreto imprevedibile a 16 caratteri casuali
    const randomBytes = new Uint8Array(8);
    crypto.getRandomValues(randomBytes);
    const randomHex = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const groupId = 'g_' + randomHex;

    const newGroup: Group = {
      id: groupId,
      name: name.trim(),
      description: description?.trim(),
      members,
      createdAt: new Date(),
    };

    const groupDocRef = doc(this.db, 'groups', groupId);
    await setDoc(groupDocRef, {
      name: newGroup.name,
      description: newGroup.description || '',
      members: newGroup.members,
      createdAt: newGroup.createdAt.toISOString(),
    });

    // Memorizza questo gruppo tra i miei gruppi
    this.rememberGroupId(groupId);

    return newGroup;
  }

  async addMemberToGroup(
    groupId: string,
    memberName: string,
    currentMembers: User[],
  ): Promise<User> {
    const newMember: User = {
      id: 'u_' + Math.random().toString(36).substring(2, 9),
      name: memberName.trim(),
    };
    const updatedMembers = [...currentMembers, newMember];
    const groupDocRef = doc(this.db, 'groups', groupId);
    await setDoc(groupDocRef, { members: updatedMembers }, { merge: true });
    return newMember;
  }

  async updateGroupInfo(groupId: string, name: string, description?: string): Promise<void> {
    const groupDocRef = doc(this.db, 'groups', groupId);
    await setDoc(
      groupDocRef,
      {
        name: name.trim(),
        description: description ? description.trim() : '',
      },
      { merge: true },
    );
  }

  async removeMemberFromGroup(
    groupId: string,
    memberId: string,
    currentMembers: User[],
  ): Promise<void> {
    // 1. Rimuovi il membro dal gruppo
    const updatedMembers = currentMembers.filter((m) => m.id !== memberId);
    const groupDocRef = doc(this.db, 'groups', groupId);
    await setDoc(groupDocRef, { members: updatedMembers }, { merge: true });

    // 2. Rimuovi il membro dalle spese in cui compare nella divisione
    const snapshot = await getDocs(collection(this.db, 'groups', groupId, 'expenses'));

    const ops = snapshot.docs
      .filter((d) => ((d.data()['splitBetweenUserIds'] as string[]) || []).includes(memberId))
      .map((d) => {
        const remaining = (d.data()['splitBetweenUserIds'] as string[]).filter(
          (id) => id !== memberId,
        );
        // Se la spesa era divisa solo con lui, non ha più senso: eliminala
        return remaining.length === 0
          ? deleteDoc(d.ref)
          : updateDoc(d.ref, {
              splitBetweenUserIds: remaining,
              splitValues: this.withoutKey(d.data()['splitValues'], memberId),
            });
      });

    await Promise.all(ops);
  }

  async deleteGroup(groupId: string): Promise<void> {
    this.forgetGroupId(groupId);

    // Prima le spese e i pagamenti del gruppo, poi il gruppo stesso
    for (const name of ['expenses', 'settlements']) {
      const snap = await getDocs(collection(this.db, 'groups', groupId, name));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
    await deleteDoc(doc(this.db, 'groups', groupId));
  }

  /** Copia di un oggetto senza una chiave (usato per togliere un membro da splitValues). */
  private withoutKey(obj: unknown, key: string): Record<string, number> {
    const copy = { ...((obj as Record<string, number>) || {}) };
    delete copy[key];
    return copy;
  }

  // --- SPESE ---
  subscribeExpenses(groupId: string, callback: (expenses: Expense[]) => void): Unsubscribe {
    const expensesRef = collection(this.db, 'groups', groupId, 'expenses');
    return onSnapshot(
      expensesRef,
      (snapshot) => {
        const expenses: Expense[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          expenses.push({
            id: docSnap.id,
            groupId: data['groupId'],
            description: data['description'],
            amount: Number(data['amount']),
            paidByUserId: data['paidByUserId'],
            splitBetweenUserIds: data['splitBetweenUserIds'] || [],
            date: data['date'] ? new Date(data['date']) : new Date(),
            category: data['category'],
            splitMode: data['splitMode'] || 'equal',
            splitValues: data['splitValues'] || {},
          });
        });
        expenses.sort((a, b) => b.date.getTime() - a.date.getTime());
        callback(expenses);
      },
      (error) => {
        console.error('Errore Firestore subscribeExpenses:', error);
      },
    );
  }

  async saveExpense(expense: Expense): Promise<void> {
    const expenseDocRef = doc(this.db, 'groups', expense.groupId, 'expenses', expense.id);
    await setDoc(expenseDocRef, {
      groupId: expense.groupId,
      description: expense.description,
      amount: expense.amount,
      paidByUserId: expense.paidByUserId,
      splitBetweenUserIds: expense.splitBetweenUserIds,
      date: expense.date instanceof Date ? expense.date.toISOString() : new Date().toISOString(),
      category: expense.category || 'altro',
      splitMode: expense.splitMode || 'equal',
      splitValues: expense.splitValues || {},
    });
  }

  async deleteExpense(groupId: string, expenseId: string): Promise<void> {
    const expenseDocRef = doc(this.db, 'groups', groupId, 'expenses', expenseId);
    await deleteDoc(expenseDocRef);
  }

  // --- PAGAMENTI (SETTLEMENTS) ---
  subscribeSettlements(
    groupId: string,
    callback: (settlements: Settlement[]) => void,
  ): Unsubscribe {
    const settlementsRef = collection(this.db, 'groups', groupId, 'settlements');
    return onSnapshot(
      settlementsRef,
      (snapshot) => {
        const settlements: Settlement[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          settlements.push({
            id: docSnap.id,
            groupId: data['groupId'],
            fromUserId: data['fromUserId'],
            toUserId: data['toUserId'],
            amount: Number(data['amount']),
            date: data['date'] ? new Date(data['date']) : new Date(),
          });
        });
        settlements.sort((a, b) => b.date.getTime() - a.date.getTime());
        callback(settlements);
      },
      (error) => {
        console.error('Errore Firestore subscribeSettlements:', error);
      },
    );
  }

  async saveSettlement(settlement: Settlement): Promise<void> {
    const ref = doc(this.db, 'groups', settlement.groupId, 'settlements', settlement.id);
    await setDoc(ref, {
      groupId: settlement.groupId,
      fromUserId: settlement.fromUserId,
      toUserId: settlement.toUserId,
      amount: settlement.amount,
      date:
        settlement.date instanceof Date ? settlement.date.toISOString() : new Date().toISOString(),
    });
  }

  async deleteSettlement(groupId: string, settlementId: string): Promise<void> {
    await deleteDoc(doc(this.db, 'groups', groupId, 'settlements', settlementId));
  }
}

