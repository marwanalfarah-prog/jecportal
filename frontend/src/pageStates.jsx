import { AlertCircle, CheckCircle2, FileText } from 'lucide-react'

const shellStyle = (minHeight) => ({
  minHeight,
  padding: '28px 24px',
  borderRadius: 16,
  border: '1px solid #e2e6ef',
  background: 'white',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  textAlign: 'center',
})

const titleStyle = {
  margin: 0,
  color: '#0f2744',
  fontFamily: 'var(--font-head)',
  fontSize: '1.08rem',
  fontWeight: 800,
}

const descriptionStyle = {
  margin: 0,
  maxWidth: 420,
  color: '#6b778f',
  fontSize: '0.9rem',
  lineHeight: 1.7,
}

const actionStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '10px 18px',
  borderRadius: 10,
  border: 'none',
  background: '#0f2744',
  color: 'white',
  fontFamily: 'var(--font-body)',
  fontSize: '0.88rem',
  fontWeight: 700,
  cursor: 'pointer',
}

export function LoadingState({
  title = 'جارٍ التحميل...',
  description = 'يتم تجهيز البيانات الآن.',
  minHeight = 280,
}) {
  return (
    <div className="loading-center" style={{ minHeight }}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 10, textAlign: 'center' }}>
        <div className="spinner" />
        <h3 style={titleStyle}>{title}</h3>
        <p style={descriptionStyle}>{description}</p>
      </div>
    </div>
  )
}

export function ErrorState({
  title = 'تعذر تحميل الصفحة',
  description = 'حدث خطأ أثناء تحميل هذه الصفحة.',
  onRetry,
  retryLabel = 'إعادة المحاولة',
  minHeight = 280,
}) {
  return (
    <div style={shellStyle(minHeight)}>
      <AlertCircle size={42} color="#c62828" />
      <h3 style={titleStyle}>{title}</h3>
      <p style={descriptionStyle}>{description}</p>
      {typeof onRetry === 'function' ? (
        <button type="button" style={actionStyle} onClick={onRetry}>{retryLabel}</button>
      ) : null}
    </div>
  )
}

export function EmptyState({
  title = 'لا توجد بيانات',
  description = 'لا توجد عناصر لعرضها حالياً.',
  icon: Icon = FileText,
  actionLabel = '',
  onAction,
  minHeight = 260,
}) {
  return (
    <div style={shellStyle(minHeight)}>
      <Icon size={42} color="#9ba5bc" />
      <h3 style={titleStyle}>{title}</h3>
      <p style={descriptionStyle}>{description}</p>
      {actionLabel && typeof onAction === 'function' ? (
        <button type="button" style={actionStyle} onClick={onAction}>{actionLabel}</button>
      ) : null}
    </div>
  )
}

export function SuccessState({
  title = 'تمت العملية بنجاح',
  description = 'تم حفظ التغييرات بنجاح.',
  actionLabel = '',
  onAction,
  minHeight = 260,
  icon: Icon = CheckCircle2,
}) {
  return (
    <div style={shellStyle(minHeight)}>
      <Icon size={42} color="#1a7a45" />
      <h3 style={titleStyle}>{title}</h3>
      <p style={descriptionStyle}>{description}</p>
      {actionLabel && typeof onAction === 'function' ? (
        <button type="button" style={actionStyle} onClick={onAction}>{actionLabel}</button>
      ) : null}
    </div>
  )
}