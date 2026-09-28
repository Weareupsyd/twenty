import { HugeiconsIcon } from '@hugeicons/react';
import { Mail01Icon } from '@hugeicons/core-free-icons';
import { defineFrontComponent } from 'twenty-sdk/define';
import { FC_SHARE_BUTTONS } from 'src/constants/universal-identifiers';

// Frontend page share actions — email and whatsapp both use HugeiconsIcon with Mail01Icon as requested
const ShareButtons = () => {
  const share = (kind: 'email' | 'whatsapp') => {
    const summary = 'Protecta Bode · Liberty General Insurance Uganda';
    if (kind === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(summary)}`, '_blank');
    } else {
      window.location.href = `mailto:?subject=${encodeURIComponent(summary)}&body=${encodeURIComponent(summary)}`;
    }
  };
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        type="button"
        onClick={() => share('whatsapp')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, border: '1px solid #BCDCE7', background: '#fff', color: '#0B1C48', fontWeight: 700, cursor: 'pointer' }}
      >
        <HugeiconsIcon icon={Mail01Icon} />
        WhatsApp
      </button>
      <button
        type="button"
        onClick={() => share('email')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, border: '1px solid #BCDCE7', background: '#fff', color: '#0B1C48', fontWeight: 700, cursor: 'pointer' }}
      >
        <HugeiconsIcon icon={Mail01Icon} />
        Email
      </button>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: FC_SHARE_BUTTONS,
  name: 'share-buttons',
  component: ShareButtons,
});
