var commerceHandler = {
    logEvent: function(event) {
        if (event.ProductAction.ProductList) {
            try {
                event.ProductAction.ProductList.forEach(function(product) {
                    Leanplum.track('Purchase', parseFloat(product.TotalAmount), product);
                });
                return true;
            }
            catch (e) {
                return {error: e};
            }
        }
    }
};

module.exports = commerceHandler;
