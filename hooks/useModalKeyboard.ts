import { useEffect, useRef } from 'react';

export function useModalKeyboard(isOpen: boolean, onClose: () => void) {
  const modalRef = useRef<HTMLDivElement>(null);
  // onClose を ref に持つことで、毎レンダーで関数参照が変わっても
  // effect の再実行（＝focus の奪取）を防ぐ
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };

    document.addEventListener('keydown', handleKeyDown);

    // isOpen が true になったときだけフォーカスをモーダルに移動
    modalRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]); // onClose を依存配列から除外

  return modalRef;
}
