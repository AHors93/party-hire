// Shapes shared by the server and the browser code. Types only – nothing here exists at runtime.

export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'completed' | 'cancelled';
export type DepositStatus = 'due' | 'received' | 'returned' | 'kept';
export type PaymentMethod = 'cash' | 'bank_transfer';
export type RouteMethod = 'road' | 'estimate';

export interface Stock {
  tables: number;
  chairs: number;
}

export interface DeliveryEstimate {
  oneWayMiles: number;
  totalMiles: number;
  fuelCost: number;
  fee: number;
  outOfArea: boolean;
}

export interface DeliveryQuoteOk extends DeliveryEstimate {
  postcode: string;
  area: string;
  method: RouteMethod;
  error?: undefined;
  badPostcode?: undefined;
}

export interface DeliveryQuoteError {
  error: string;
  badPostcode?: boolean;
}

export type DeliveryQuote = DeliveryQuoteOk | DeliveryQuoteError;

export interface Booking {
  id: string;
  ref: string;
  status: BookingStatus;
  name: string;
  phone: string;
  email: string;
  start: string;
  end: string;
  days: number;
  tables: number;
  chairs: number;
  delivery: boolean;
  address: string;
  postcode: string;
  paymentMethod: PaymentMethod;
  notes: string;
  tablesCost: number;
  chairsCost: number;
  hireTotal: number;
  deliveryQuote: DeliveryQuote | null;
  deliveryFee: number | null;
  bookingFee: number;
  total: number;
  deposit: number;
  depositStatus: DepositStatus | null;
  depositReturnedAt?: string;
  paid?: boolean;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicConfig {
  businessName: string;
  contactPhone: string;
  tablePrice: number;
  chairPrice: number;
  totalTables: number;
  totalChairs: number;
  maxHireDays: number;
  deliveryEnabled: boolean;
  maxDeliveryMiles: number;
  depositPercent: number;
  bookingFee: number;
  paymentMethods: Record<PaymentMethod, string>;
  today: string;
}

export interface AvailabilityResponse {
  days: Record<string, Stock>;
}

export interface HireQuote {
  days: number;
  tablesCost: number;
  chairsCost: number;
  hireTotal: number;
  deposit: number;
}

export interface QuoteResponse extends Partial<HireQuote> {
  errors: string[];
  remaining?: Stock;
  delivery?: DeliveryQuote;
}

export interface CreateBookingResponse {
  ok: true;
  id?: string;
  ref?: string;
  statusUrl?: string;
}

export interface PublicBooking {
  id: string;
  ref: string;
  status: BookingStatus;
  name: string;
  start: string;
  end: string;
  dates: string;
  days: number;
  tables: number;
  chairs: number;
  delivery: boolean;
  paymentMethod: string;
  hireTotal: number;
  deliveryFee: number | null;
  bookingFee: number;
  total: number;
  deposit: number;
  depositStatus: DepositStatus | null;
  amountDue: number;
  createdAt: string;
}

export interface PublicBookingResponse {
  booking: PublicBooking;
  contactPhone: string;
  businessName: string;
}

export interface AdminBooking extends Booking {
  paymentLabel: string;
  dates: string;
  statusUrl: string;
  amountDue: number;
  wouldOverbook: boolean;
  stockLeft: Stock;
}

export interface AdminBookingsResponse {
  bookings: AdminBooking[];
  businessName: string;
  bankDetails: string;
  totals: Stock;
}

export interface AdminPatchBody {
  status?: BookingStatus;
  force?: boolean;
  deliveryFee?: number | string | null;
  adminNotes?: string;
  paid?: boolean;
  depositStatus?: DepositStatus;
}
