if (!customElements.get('product-form')) {
  customElements.define(
    'product-form',
    class ProductForm extends HTMLElement {
      constructor() {
        super();

        this.form = this.querySelector('form');
        this.variantIdInput = this.form.querySelector('[name=id]');
        if (this.variantIdInput) this.variantIdInput.disabled = false;
        
        this.form.addEventListener('submit', this.onSubmitHandler.bind(this));
        this.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        this.submitButton = this.querySelector('[type="submit"]');
        this.submitButtonText = this.submitButton ? this.submitButton.querySelector('span.btn-text') || this.submitButton.querySelector('span.add-text') || this.submitButton.querySelector('span') : null;

        if (document.querySelector('cart-drawer') && this.submitButton) this.submitButton.setAttribute('aria-haspopup', 'dialog');

        this.hideErrors = this.dataset.hideErrors === 'true';

        // GLOBAL UPLOADKIT UI LOCK
        setInterval(() => {
          if (!this.submitButton) return;
          
          // Checks for active upload states from Uploadcare/UploadKit
          const isUploading = document.querySelector('.uploadcare-widget_status_uploading, .uploadcare-widget_status_started, .uploadcare--progress, .uploadcare--button_state_uploading, .uploadkit-uploading');
          
          if (isUploading) {
            this.submitButton.disabled = true;
            this.submitButton.style.pointerEvents = 'none';
            if (!this.submitButton.dataset.uploadingText && this.submitButtonText) {
              this.submitButton.dataset.originalHtml = this.submitButtonText.innerHTML;
              this.submitButton.dataset.uploadingText = 'true';
              this.submitButtonText.innerHTML = 'Uploading...';
            }
          } else {
            if (this.submitButton.dataset.uploadingText && this.submitButtonText) {
              this.submitButton.disabled = false;
              this.submitButton.style.pointerEvents = 'all';
              this.submitButtonText.innerHTML = this.submitButton.dataset.originalHtml;
              delete this.submitButton.dataset.uploadingText;
            }
          }
        }, 200);
      }

      onSubmitHandler(evt) {
        // 1. STRICT BLOCK: If somehow clicked while uploading, stop everything immediately.
        const isUploading = document.querySelector('.uploadcare-widget_status_uploading, .uploadcare-widget_status_started, .uploadcare--progress, .uploadcare--button_state_uploading, .uploadkit-uploading');
        if (isUploading) {
          evt.preventDefault();
          evt.stopImmediatePropagation();
          return false;
        }

        // 2. UPLOADKIT BYPASS: Let UploadKit validate fields and submit natively
        if (document.querySelector('.uploadkit') || document.querySelector('[class*="uploadkit"]')) {
          return; // Allow the native browser submit to happen so UploadKit can intercept it
        }

        evt.preventDefault();
        if (this.submitButton.getAttribute('aria-disabled') === 'true') return;

        this.handleErrorMessage();

        this.submitButton.setAttribute('aria-disabled', true);
        this.submitButton.classList.add('loading');
        this.querySelector('.loading__spinner').classList.remove('hidden');

        const config = fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        const formData = new FormData(this.form);
        if (this.cart) {
          formData.append(
            'sections',
            this.cart.getSectionsToRender().map((section) => section.id)
          );
          formData.append('sections_url', window.location.pathname);
          this.cart.setActiveElement(document.activeElement);
        }
        config.body = formData;

        fetch(`${routes.cart_add_url}`, config)
          .then((response) => response.json())
          .then((response) => {
            if (response.status) {
              publish(PUB_SUB_EVENTS.cartError, {
                source: 'product-form',
                productVariantId: formData.get('id'),
                errors: response.errors || response.description,
                message: response.message,
              });
              this.handleErrorMessage(response.description);

              const soldOutMessage = this.submitButton.querySelector('.sold-out-message');
              if (!soldOutMessage) return;
              this.submitButton.setAttribute('aria-disabled', true);
              if(this.submitButtonText) this.submitButtonText.classList.add('hidden');
              soldOutMessage.classList.remove('hidden');
              this.error = true;
              return;
            } else if (!this.cart) {
              window.location = window.routes.cart_url;
              return;
            }

            const startMarker = CartPerformance.createStartingMarker('add:wait-for-subscribers');
            if (!this.error)
              publish(PUB_SUB_EVENTS.cartUpdate, {
                source: 'product-form',
                productVariantId: formData.get('id'),
                cartData: response,
              }).then(() => {
                CartPerformance.measureFromMarker('add:wait-for-subscribers', startMarker);
              });
            this.error = false;
            const quickAddModal = this.closest('quick-add-modal');
            if (quickAddModal) {
              document.body.addEventListener(
                'modalClosed',
                () => {
                  setTimeout(() => {
                    CartPerformance.measure("add:paint-updated-sections", () => {
                      this.cart.renderContents(response);
                    });
                  });
                },
                { once: true }
              );
              quickAddModal.hide(true);
            } else {
              CartPerformance.measure("add:paint-updated-sections", () => {
                this.cart.renderContents(response);
              });
            }
          })
          .catch((e) => {
            console.error(e);
          })
          .finally(() => {
            this.submitButton.classList.remove('loading');
            if (this.cart && this.cart.classList.contains('is-empty')) this.cart.classList.remove('is-empty');
            if (!this.error) this.submitButton.removeAttribute('aria-disabled');
            this.querySelector('.loading__spinner').classList.add('hidden');

            CartPerformance.measureFromEvent("add:user-action", evt);
          });
      }

      handleErrorMessage(errorMessage = false) {
        if (this.hideErrors) return;

        this.errorMessageWrapper =
          this.errorMessageWrapper || this.querySelector('.product-form__error-message-wrapper');
        if (!this.errorMessageWrapper) return;
        this.errorMessage = this.errorMessage || this.errorMessageWrapper.querySelector('.product-form__error-message');

        this.errorMessageWrapper.toggleAttribute('hidden', !errorMessage);

        if (errorMessage) {
          this.errorMessage.textContent = errorMessage;
        }
      }

      toggleSubmitButton(disable = true, text) {
        if (disable) {
          this.submitButton.setAttribute('disabled', 'disabled');
          if (text && this.submitButtonText) this.submitButtonText.textContent = text;
        } else {
          this.submitButton.removeAttribute('disabled');
          if(this.submitButtonText) this.submitButtonText.textContent = window.variantStrings.addToCart;
        }
      }
    }
  );
}