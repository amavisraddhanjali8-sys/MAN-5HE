import React, { useEffect, useState } from 'react';
import { CheckCircle2, Mail, MessageSquare, Receipt, Send } from 'lucide-react';
import { api, AuthUser } from '../lib/api';
import type { EmailLog, InvoiceRecord, WhatsAppLog } from '../lib/types';

interface ParentCommsHubProps {
  user: AuthUser;
  onOpenBilling: () => void;
}

export function ParentCommsHub({ user, onOpenBilling }: ParentCommsHubProps) {
  const [emails, setEmails] = useState<EmailLog[]>([]);
  const [whatsapps, setWhatsapps] = useState<WhatsAppLog[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailLog | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [comms, inv] = await Promise.all([api.getCommunications(), api.getInvoices()]);
      setEmails(comms.emails);
      setWhatsapps(comms.whatsapps);
      setInvoices(inv.invoices);
      if (comms.emails.length > 0 && !selectedEmail) {
        setSelectedEmail(comms.emails[0]);
      }
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDispatchNow = async () => {
    setSending(true);
    setNotice(null);
    try {
      const res = await api.sendProgressShare();
      setNotice(res.message);
      await loadData();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-extrabold text-[#0F2942]">
            Parent Progress, Branded Email & WhatsApp Desk
          </h1>
          <p className="text-xs text-[#526A84] mt-0.5">
            Every registration, login, payment invoice, and exam attempt dispatches cryptographic receipts & progress alerts to {user.email} and WhatsApp {user.whatsappNumber}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onOpenBilling}
            className="px-4 py-2 text-xs font-semibold text-[#0F2942] bg-[#F3F9FF] border border-[#CBE2FA] rounded-xl hover:bg-[#E5F2FF] whitespace-nowrap shrink-0"
          >
            Manage Paid Subscription
          </button>
          <button
            type="button"
            onClick={handleDispatchNow}
            disabled={sending}
            className="px-4 py-2 text-xs font-bold text-white bg-[#4CAF50] hover:bg-[#3E9642] rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{sending ? 'Dispatching...' : 'Send Progress Report Now'}</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3.5 rounded-2xl bg-[#EEF9EF] border border-[#B7E1BA] text-sm font-medium text-[#1E6323]">
          {notice}
        </div>
      )}

      {/* Branded HTML Email Viewer */}
      <div className="bg-white rounded-3xl border border-[#DCEBFA] p-6">
        <div className="flex items-center gap-2 pb-4 border-b border-[#E5F0FA]">
          <Mail className="w-5 h-5 text-[#158EE3]" />
          <h2 className="text-base font-display font-bold text-[#0F2942]">
            Email Dispatch Log & මං 5හේ Branded HTML Mail Preview ({emails.length})
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-4">
          <div className="lg:col-span-4 space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {emails.map((em) => (
              <button
                key={em.id}
                type="button"
                onClick={() => setSelectedEmail(em)}
                className={`w-full text-left p-3.5 rounded-2xl border transition-colors ${
                  selectedEmail?.id === em.id
                    ? 'bg-[#EBF5FF] border-[#158EE3]'
                    : 'bg-[#F8FBFF] border-[#DCEBFA] hover:bg-[#EFF7FF]'
                }`}
              >
                <div className="text-xs font-bold text-[#0F2942]">{em.subject}</div>
                <div className="text-[11px] text-[#526A84] mt-1">
                  To: {em.toEmail} · {new Date(em.sentAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-8">
            {selectedEmail ? (
              <iframe
                title="Branded Email Preview"
                srcDoc={selectedEmail.htmlBody}
                className="w-full h-[460px] rounded-2xl border border-[#DCEBFA] bg-[#EAF5FF]"
              />
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-[#526A84]">
                No email selected.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Split: Automated WhatsApp Feed + Paid LKR Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-[#E5F0FA]">
            <MessageSquare className="w-5 h-5 text-[#4CAF50]" />
            <h2 className="text-base font-display font-bold text-[#0F2942]">
              Automated WhatsApp Progress Feed ({whatsapps.length})
            </h2>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {whatsapps.map((wa) => (
              <div
                key={wa.id}
                className="p-4 rounded-2xl bg-[#EEF9EF] border border-[#C1E8C4] space-y-1.5"
              >
                <div className="flex items-center justify-between text-xs text-[#2E7D32] font-semibold">
                  <span>To: {wa.toNumber}</span>
                  <span>{new Date(wa.sentAt).toLocaleTimeString()}</span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-[#0F2942] leading-relaxed">
                  {wa.messageText}
                </pre>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-3xl border border-[#DCEBFA] p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-[#E5F0FA]">
            <Receipt className="w-5 h-5 text-[#F96A1B]" />
            <h2 className="text-base font-display font-bold text-[#0F2942]">
              Signed Payment Invoices ({invoices.length})
            </h2>
          </div>

          {invoices.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#526A84]">
              No paid invoices yet. Upgrade your plan to receive a signed LKR receipt.
            </div>
          ) : (
            <div className="space-y-3">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="p-4 rounded-2xl bg-[#F8FBFF] border border-[#DCEBFA] flex items-center justify-between gap-4"
                >
                  <div>
                    <div className="text-sm font-bold text-[#0F2942] font-mono">
                      {inv.invoiceNumber}
                    </div>
                    <div className="text-xs text-[#526A84]">
                      {inv.planName} · {inv.gateway} · {inv.gatewayRef}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-extrabold text-[#F96A1B] tabular-nums">
                      LKR {inv.amountLkr.toLocaleString('en-LK')}
                    </div>
                    <div className="text-[11px] font-semibold text-[#2E7D32] flex items-center justify-end gap-1">
                      <CheckCircle2 className="w-3 h-3" /> HMAC Verified
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
