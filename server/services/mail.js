// Envoi d'e-mails (réinitialisation de mot de passe). Configuration par variables d'environnement :
//   SMTP_URL   ex. smtps://utilisateur:cle@smtp-relay.brevo.com:465  (sans SMTP_URL : rien n'est envoyé, le lien est journalisé)
//   MAIL_FROM  ex. "Chess Coach IA <contact@mondomaine.fr>"
import nodemailer from 'nodemailer';

let transport = null;
export function mailEnabled() { return !!process.env.SMTP_URL; }

function getTransport() {
  if (!transport) transport = nodemailer.createTransport(process.env.SMTP_URL);
  return transport;
}

export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled()) return { sent: false };
  const from = process.env.MAIL_FROM || 'Chess Coach IA <no-reply@example.com>';
  await getTransport().sendMail({ from, to, subject, text, html });
  return { sent: true };
}

export function resetPasswordMail(link) {
  return {
    subject: 'Réinitialisation de votre mot de passe — Chess Coach IA',
    text: `Bonjour,\n\nVous avez demandé à réinitialiser votre mot de passe sur Chess Coach IA.\nOuvrez ce lien (valable 1 heure) :\n\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.\n\nChess Coach IA`,
    html: `<p>Bonjour,</p><p>Vous avez demandé à réinitialiser votre mot de passe sur <strong>Chess Coach IA</strong>.</p>
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#77749B;color:#fff;text-decoration:none;border-radius:8px">Choisir un nouveau mot de passe</a></p>
<p style="color:#666;font-size:13px">Le lien est valable 1 heure. Si le bouton ne fonctionne pas, copiez cette adresse : ${link}</p>
<p style="color:#666;font-size:13px">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.</p>`,
  };
}
